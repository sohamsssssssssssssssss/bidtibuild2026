-- CivicPulse AI — Phase 5: City Pulse (02 §6; 04 §3; 06 rules 1, 3, 7).
--
-- regenerate_city_pulse(p_config) recomputes the hotspot set from the open issues of the last
-- input_window_hours and replaces the active set; active_hotspots() reads it. Every number comes from
-- p_config = CITY_PULSE_CONFIG (src/config/civic.ts); none is hard-coded here. A malformed p_config is
-- a programming error: 22023 (the route maps it to INTERNAL). Hotspots are never seeded (06 rule 3).

-- active_hotspots — GET /api/hotspots (via the service role). Read only; a jsonb array of the active
-- hotspots, each {id, category, severity, geometry (GeoJSON Polygon, 6 decimals), current_issue_count,
-- baseline_issue_count, expected_current_count (2 decimals), trend_percent (1 decimal), explanation,
-- window_start, window_end, generated_at, member_issue_ids}. member_issue_ids are the hotspot_issues
-- rows ordered by issue created_at (then id), excluding issues that are now REJECTED (hidden publicly,
-- 06 §21). Order: severity CRITICAL → LOW, then current_issue_count desc, then id.
create function public.active_hotspots()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(q.item order by q.severity desc, q.current_issue_count desc, q.id), '[]'::jsonb)
  from (
    select
      h.id,
      h.severity,
      h.current_issue_count,
      jsonb_build_object(
        'id', h.id,
        'category', h.category,
        'severity', h.severity,
        'geometry', st_asgeojson(h.geom::geometry, 6)::jsonb,
        'current_issue_count', h.current_issue_count,
        'baseline_issue_count', h.baseline_issue_count,
        'expected_current_count', round(h.expected_current_count, 2),
        'trend_percent', round(h.trend_percent, 1),
        'explanation', h.explanation,
        'window_start', h.window_start,
        'window_end', h.window_end,
        'generated_at', h.generated_at,
        'member_issue_ids', coalesce((
          select jsonb_agg(i.id order by i.created_at, i.id)
          from public.hotspot_issues hi
          join public.issues i on i.id = hi.issue_id
          where hi.hotspot_id = h.id and i.status <> 'REJECTED'
        ), '[]'::jsonb)
      ) as item
    from public.hotspots h
    where h.active
  ) q
$$;

revoke all on function public.active_hotspots() from public, anon, authenticated;
grant execute on function public.active_hotspots() to service_role;

-- regenerate_city_pulse — report route (after()), POST /api/hotspots/regenerate, demo:reset.
-- 02 §6, with every number from p_config:
--   lock      pg_advisory_xact_lock(hashtext('city_pulse')) first, so concurrent runs queue up
--             (02 §6.8); each run then sees the previous run's committed set and deactivates it.
--   v_now     now() (transaction time), the generated_at and window_end of every new row.
--   input     issues with status in input_statuses and created_at > v_now - input_window_hours.
--             Issues, not reports: supporting reports never add to a count (02 §6.1, 06 rule 7).
--   cluster   ST_ClusterDBSCAN(ST_Transform(geom::geometry, cluster_srid), eps := cluster_eps_m,
--             minpoints := cluster_min_points) OVER (PARTITION BY category); noise (null) ignored.
--   counts    current = members created after v_now - current_window_hours; baseline = the rest.
--   trend     expected = baseline / baseline_divisor;
--             trend % = (current - expected) / greatest(expected, expected_floor) * 100.
--             Active hotspot only if current >= min_current_count.
--   severity  trend_thresholds_percent {MEDIUM, HIGH, CRITICAL} (inclusive lower bounds); CRITICAL
--             also needs current >= critical_min_current_count, else capped at HIGH.
--   geometry  ST_Buffer(ST_ConvexHull(ST_Collect(members in cluster_srid)), buffer_m) → 4326,
--             stored as geography(Polygon); buffer_m > 0 keeps it an area for collinear points.
--   members   every cluster member (current + baseline) → hotspot_issues.
--   text      '<current> <CATEGORY> issues within ~<eps> m in the last <current h> h (expected
--             <expected, 1 decimal>) — trend <sign><trunc(trend)>%.', sign always shown ('+' for 0),
--             e.g. '6 DRAINAGE issues within ~300 m in the last 2 h (expected 0.3) — trend +566%.'
-- One transaction: deactivate every active hotspot (old rows stay as history), insert the new ones
-- and their memberships. Returns {generated_at, hotspots: active_hotspots()} — the new active set.
create function public.regenerate_city_pulse(p_config jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_now                timestamptz;
  v_statuses           public.issue_status[];
  v_input_hours        numeric;
  v_srid               integer;
  v_eps                numeric;
  v_min_points         integer;
  v_current_hours      numeric;
  v_baseline_hours     numeric;
  v_divisor            numeric;
  v_floor              numeric;
  v_min_current        integer;
  v_t_medium           numeric;
  v_t_high             numeric;
  v_t_critical         numeric;
  v_critical_min       integer;
  v_buffer             numeric;
  v_current_start      timestamptz;
begin
  -- 02 §6.8: concurrent runs queue up here (released at commit/rollback).
  perform pg_advisory_xact_lock(hashtext('city_pulse'));

  v_input_hours    := (p_config ->> 'input_window_hours')::numeric;
  v_srid           := (p_config ->> 'cluster_srid')::integer;
  v_eps            := (p_config ->> 'cluster_eps_m')::numeric;
  v_min_points     := (p_config ->> 'cluster_min_points')::integer;
  v_current_hours  := (p_config ->> 'current_window_hours')::numeric;
  v_baseline_hours := (p_config ->> 'baseline_window_hours')::numeric;
  v_divisor        := (p_config ->> 'baseline_divisor')::numeric;
  v_floor          := (p_config ->> 'expected_floor')::numeric;
  v_min_current    := (p_config ->> 'min_current_count')::integer;
  v_t_medium       := (p_config -> 'trend_thresholds_percent' ->> 'MEDIUM')::numeric;
  v_t_high         := (p_config -> 'trend_thresholds_percent' ->> 'HIGH')::numeric;
  v_t_critical     := (p_config -> 'trend_thresholds_percent' ->> 'CRITICAL')::numeric;
  v_critical_min   := (p_config ->> 'critical_min_current_count')::integer;
  v_buffer         := (p_config ->> 'buffer_m')::numeric;

  if jsonb_typeof(p_config -> 'input_statuses') is distinct from 'array' then
    raise exception 'p_config.input_statuses must be an array' using errcode = '22023';
  end if;
  if v_input_hours is null or v_input_hours <= 0 or v_srid is null or v_eps is null or v_eps <= 0
     or v_min_points is null or v_min_points < 1 or v_current_hours is null or v_current_hours <= 0
     or v_baseline_hours is null or v_baseline_hours < 0 or v_divisor is null or v_divisor <= 0
     or v_floor is null or v_floor <= 0 or v_min_current is null or v_critical_min is null
     or v_buffer is null or v_buffer <= 0 then
    raise exception 'p_config must contain input_window_hours, cluster_srid, cluster_eps_m, cluster_min_points, '
      'current_window_hours, baseline_window_hours, baseline_divisor, expected_floor, min_current_count, '
      'critical_min_current_count and buffer_m (positive where they divide, buffer or window)' using errcode = '22023';
  end if;
  if v_t_medium is null or v_t_high is null or v_t_critical is null then
    raise exception 'p_config.trend_thresholds_percent must contain MEDIUM, HIGH and CRITICAL' using errcode = '22023';
  end if;
  v_statuses := array(select s::public.issue_status from jsonb_array_elements_text(p_config -> 'input_statuses') s);

  v_now := now();
  v_current_start := v_now - v_current_hours * interval '1 hour';

  -- Old rows stay as history (inactive).
  update public.hotspots set active = false where active;

  with input as (
    -- §6.2: distinct issues, never reports.
    select i.id, i.category, i.created_at, st_transform(i.geom::geometry, v_srid) as pt
    from public.issues i
    where i.status = any (v_statuses)
      and i.created_at > v_now - v_input_hours * interval '1 hour'
  ), members as (
    -- §6.3: DBSCAN per exact category; noise (null cluster id) dropped.
    select c.*
    from (
      select n.*, st_clusterdbscan(n.pt, eps := v_eps::double precision, minpoints := v_min_points)
                    over (partition by n.category) as cid
      from input n
    ) c
    where c.cid is not null
  ), clusters as materialized (
    -- §6.4 counts and §6.6 shape, one row per cluster, with the new hotspot's id.
    select m.category, m.cid,
           gen_random_uuid() as hotspot_id,
           count(*) filter (where m.created_at > v_current_start)::integer as current_count,
           count(*) filter (where m.created_at <= v_current_start)::integer as baseline_count,
           st_transform(st_buffer(st_convexhull(st_collect(m.pt)), v_buffer::double precision), 4326) as shape
    from members m
    group by m.category, m.cid
  ), scored as (
    -- §6.4 trend; only clusters with current >= min_current_count become hotspots.
    select t.*, (t.current_count - t.expected) / greatest(t.expected, v_floor) * 100 as trend
    from (select c.*, c.baseline_count / v_divisor as expected
          from clusters c
          where c.current_count >= v_min_current) t
  ), new_hotspots as (
    insert into public.hotspots (id, category, geom, current_issue_count, baseline_issue_count,
                                 expected_current_count, trend_percent, severity, explanation,
                                 window_start, window_end, active, generated_at)
    select
      s.hotspot_id,
      s.category,
      s.shape::geography,  -- the column is geography(Polygon, 4326): anything else raises
      s.current_count,
      s.baseline_count,
      s.expected,
      s.trend,
      case  -- §6.5
        when s.trend >= v_t_critical and s.current_count >= v_critical_min then 'CRITICAL'
        when s.trend >= v_t_critical then 'HIGH'  -- capped
        when s.trend >= v_t_high     then 'HIGH'
        when s.trend >= v_t_medium   then 'MEDIUM'
        else 'LOW'
      end::public.level,
      format('%s %s issues within ~%s m in the last %s h (expected %s) — trend %s%s%%.',  -- §6.7
             s.current_count, s.category, v_eps, v_current_hours, round(s.expected, 1),
             case when trunc(s.trend) >= 0 then '+' else '-' end, abs(trunc(s.trend))),
      v_now - v_input_hours * interval '1 hour',
      v_now,
      true,
      v_now
    from scored s
    returning id
  )
  -- §6.6 membership: every cluster member, current and baseline. (new_hotspots runs to completion
  -- before the FK checks at the end of this statement.)
  insert into public.hotspot_issues (hotspot_id, issue_id)
  select s.hotspot_id, m.id
  from scored s
  join members m on m.category = s.category and m.cid = s.cid;

  return jsonb_build_object('generated_at', v_now, 'hotspots', public.active_hotspots());
end;
$$;

revoke all on function public.regenerate_city_pulse(jsonb) from public, anon, authenticated;
grant execute on function public.regenerate_city_pulse(jsonb) to service_role;

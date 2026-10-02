-- CivicPulse AI — Phase 4: recommended priority (02 §5; 04 §3; 06 rules 11–16).
--
-- authority_queue keeps its v1 signature, filters, row keys and privileges
-- (20261002001000_authority_workflow.sql) and now fills factors, score, label and recurrence_count,
-- computed at read time from p_config = PRIORITY_CONFIG (src/config/civic.ts). Nothing is stored
-- (02 §5.2). Every number comes from p_config; none is hard-coded here.

-- priority_label — 02 §5.9. Maps a score to LOW | MEDIUM | HIGH | CRITICAL using
-- p_config.label_thresholds {MEDIUM, HIGH, CRITICAL}, each an inclusive lower bound (below MEDIUM is
-- LOW). authority_queue passes the UNROUNDED score. Null score → null. Missing thresholds are a
-- programming error (22023). Mirrors priorityLabel() in civic.ts.
create function public.priority_label(p_score numeric, p_config jsonb)
returns public.level
language plpgsql
immutable
security definer
set search_path = public, extensions
as $$
declare
  v_medium   numeric := (p_config -> 'label_thresholds' ->> 'MEDIUM')::numeric;
  v_high     numeric := (p_config -> 'label_thresholds' ->> 'HIGH')::numeric;
  v_critical numeric := (p_config -> 'label_thresholds' ->> 'CRITICAL')::numeric;
begin
  if v_medium is null or v_high is null or v_critical is null then
    raise exception 'p_config.label_thresholds must contain MEDIUM, HIGH and CRITICAL' using errcode = '22023';
  end if;
  return case
    when p_score is null       then null
    when p_score >= v_critical then 'CRITICAL'
    when p_score >= v_high     then 'HIGH'
    when p_score >= v_medium   then 'MEDIUM'
    else 'LOW'
  end::public.level;
end;
$$;

revoke all on function public.priority_label(numeric, jsonb) from public, anon, authenticated;
grant execute on function public.priority_label(numeric, jsonb) to service_role;

-- authority_queue — GET /api/authority/queue. Read only; a jsonb array, one element per issue whose
-- status is in p_filters.statuses (default p_config.queue_statuses = the open statuses).
-- p_filters: {statuses: text[]|null, categories: text[]|null, department_id: uuid|null,
-- unassigned_only: boolean}; null / missing = no filter (unchanged from v1).
--
-- Recommended priority (02 §5), per issue, with every number from p_config:
--   severity      = severity_values[effective severity]; effective severity = authority_severity →
--                   citizen_severity → default_severity (severity_source AUTHORITY | CITIZEN | DEFAULT).
--                   AI severity never enters (06 rule 13).
--   support       = min(factor_max, support_multiplier * log2(1 + distinct reporter_user_id))
--   age           = min(factor_max, hours since created_at / age_full_hours * factor_max)  (now(), ≥ 0)
--   location_risk = max(risk_value) of risk_zones intersecting the issue, else default_location_risk
--   recurrence    = min(factor_max, recurrence_points_per_issue * recurrence_count); recurrence_count =
--                   OTHER issues with status RESOLVED, the same exact category, within
--                   recurrence_radius_m_by_category[category] metres, resolved_at >= now() -
--                   recurrence_window_days
--   score         = Σ weights[k] * factor_k, from the unrounded factors
--   label         = priority_label(unrounded score, p_config)
-- factors and score are returned rounded to 2 decimals. Order: the returned (rounded) score desc,
-- then created_at asc, then id — so equal displayed scores show the oldest first.
-- Location risk and recurrence are lateral lookups that use the GiST indexes on risk_zones.geom
-- (ST_Intersects) and issues.geom (ST_DWithin).
-- ponytail: every factor is recomputed per open issue on each call. That's fine into the low
-- thousands of issues; materialise the factors if the queue gets slow.
-- A malformed p_config is a programming error: 22023 (the route maps it to INTERNAL).
-- Never returns reporter ids — only counts.
create or replace function public.authority_queue(p_config jsonb, p_filters jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_filters          jsonb := coalesce(p_filters, '{}'::jsonb);
  v_default_severity public.level := (p_config ->> 'default_severity')::public.level;
  v_w_severity       numeric := (p_config -> 'weights' ->> 'severity')::numeric;
  v_w_support        numeric := (p_config -> 'weights' ->> 'support')::numeric;
  v_w_age            numeric := (p_config -> 'weights' ->> 'age')::numeric;
  v_w_location       numeric := (p_config -> 'weights' ->> 'location_risk')::numeric;
  v_w_recurrence     numeric := (p_config -> 'weights' ->> 'recurrence')::numeric;
  v_severity_values  jsonb := p_config -> 'severity_values';
  v_factor_max       numeric := (p_config ->> 'factor_max')::numeric;
  v_support_mult     numeric := (p_config ->> 'support_multiplier')::numeric;
  v_age_full_hours   numeric := (p_config ->> 'age_full_hours')::numeric;
  v_default_risk     numeric := (p_config ->> 'default_location_risk')::numeric;
  v_window_days      numeric := (p_config ->> 'recurrence_window_days')::numeric;
  v_points_per_issue numeric := (p_config ->> 'recurrence_points_per_issue')::numeric;
  v_radius_by_cat    jsonb := p_config -> 'recurrence_radius_m_by_category';
  v_window_start     timestamptz;
  v_statuses         public.issue_status[];
  v_categories       public.issue_category[];
  v_department_id    uuid := (v_filters ->> 'department_id')::uuid;
  v_unassigned_only  boolean := coalesce((v_filters ->> 'unassigned_only')::boolean, false);
  v_result           jsonb;
begin
  if v_default_severity is null or jsonb_typeof(p_config -> 'queue_statuses') is distinct from 'array' then
    raise exception 'p_config must contain queue_statuses and default_severity' using errcode = '22023';
  end if;
  if v_w_severity is null or v_w_support is null or v_w_age is null or v_w_location is null
     or v_w_recurrence is null then
    raise exception 'p_config.weights must contain severity, support, age, location_risk and recurrence'
      using errcode = '22023';
  end if;
  if v_factor_max is null or v_support_mult is null or v_age_full_hours is null or v_age_full_hours <= 0
     or v_default_risk is null or v_window_days is null or v_points_per_issue is null then
    raise exception 'p_config must contain factor_max, support_multiplier, age_full_hours (> 0), '
      'default_location_risk, recurrence_window_days and recurrence_points_per_issue' using errcode = '22023';
  end if;
  if jsonb_typeof(v_severity_values) is distinct from 'object'
     or exists (select 1 from unnest(enum_range(null::public.level)) l
                where jsonb_typeof(v_severity_values -> l::text) is distinct from 'number') then
    raise exception 'p_config.severity_values must give a number for every level' using errcode = '22023';
  end if;
  if jsonb_typeof(v_radius_by_cat) is distinct from 'object'
     or exists (select 1 from unnest(enum_range(null::public.issue_category)) c
                where jsonb_typeof(v_radius_by_cat -> c::text) is distinct from 'number') then
    raise exception 'p_config.recurrence_radius_m_by_category must give a number for every category'
      using errcode = '22023';
  end if;
  perform public.priority_label(0, p_config);  -- validates label_thresholds

  v_window_start := now() - v_window_days * interval '1 day';

  v_statuses := array(
    select s::public.issue_status
    from jsonb_array_elements_text(case jsonb_typeof(v_filters -> 'statuses')
                                     when 'array' then v_filters -> 'statuses'
                                     else p_config -> 'queue_statuses' end) s);
  if jsonb_typeof(v_filters -> 'categories') = 'array' then
    v_categories := array(select c::public.issue_category from jsonb_array_elements_text(v_filters -> 'categories') c);
  end if;

  with base as (
    -- The filtered issues plus their inputs (v1 filters, unchanged).
    select
      i.*,
      coalesce(i.authority_severity, i.citizen_severity, v_default_severity) as eff_severity,
      case
        when i.authority_severity is not null then 'AUTHORITY'
        when i.citizen_severity is not null then 'CITIZEN'
        else 'DEFAULT'
      end as severity_source,
      rc.reports,
      rc.distinct_reporters,
      loc.max_risk,
      rec.recurrence_count
    from public.issues i
    cross join lateral (
      select count(*)::integer as reports, count(distinct r.reporter_user_id)::integer as distinct_reporters
      from public.reports r where r.issue_id = i.id
    ) rc
    cross join lateral (
      -- GiST: risk_zones_geom_gix
      select max(z.risk_value)::numeric as max_risk
      from public.risk_zones z
      where st_intersects(z.geom, i.geom)
    ) loc
    cross join lateral (
      -- GiST: issues_geom_gix
      select count(*)::integer as recurrence_count
      from public.issues o
      where o.id <> i.id
        and o.status = 'RESOLVED'
        and o.category = i.category
        and o.resolved_at >= v_window_start
        and st_dwithin(o.geom, i.geom, (v_radius_by_cat ->> i.category::text)::double precision)
    ) rec
    where i.status = any (v_statuses)
      and (v_categories is null or i.category = any (v_categories))
      and (v_department_id is null or i.assigned_department_id = v_department_id)
      and (not v_unassigned_only or i.assigned_department_id is null)
  ),
  factored as (
    -- Unrounded factors (02 §5.4–5.8).
    select
      b.*,
      (v_severity_values ->> b.eff_severity::text)::numeric as f_severity,
      least(v_factor_max, v_support_mult * log(2::numeric, (1 + b.distinct_reporters)::numeric)) as f_support,
      least(v_factor_max,
            greatest(0::numeric, extract(epoch from (now() - b.created_at))::numeric / 3600)
              / v_age_full_hours * v_factor_max) as f_age,
      coalesce(b.max_risk, v_default_risk) as f_location,
      least(v_factor_max, v_points_per_issue * b.recurrence_count) as f_recurrence
    from base b
  ),
  scored as (
    -- Score from the unrounded factors (02 §5.9).
    select
      f.*,
      v_w_severity * f.f_severity + v_w_support * f.f_support + v_w_age * f.f_age
        + v_w_location * f.f_location + v_w_recurrence * f.f_recurrence as raw_score
    from factored f
  )
  select coalesce(jsonb_agg(q.item order by q.score desc, q.created_at, q.id), '[]'::jsonb)
  into v_result
  from (
    select
      s.id,
      s.created_at,
      round(s.raw_score, 2) as score,
      jsonb_build_object(
        'id', s.id,
        'category', s.category,
        'status', s.status,
        'final_priority', s.final_priority,
        'effective_severity', s.eff_severity,
        'severity_source', s.severity_source,
        'factors', jsonb_build_object(
          'severity', round(s.f_severity, 2),
          'support', round(s.f_support, 2),
          'age', round(s.f_age, 2),
          'location_risk', round(s.f_location, 2),
          'recurrence', round(s.f_recurrence, 2)
        ),
        'score', round(s.raw_score, 2),
        'label', public.priority_label(s.raw_score, p_config),
        'distinct_reporter_count', s.distinct_reporters,
        'recurrence_count', s.recurrence_count,
        'report_count', s.reports,
        'department', case when d.id is null then null else jsonb_build_object('id', d.id, 'name', d.name) end,
        'sla_due_at', s.sla_due_at,
        'created_at', s.created_at,
        'updated_at', s.updated_at,
        'is_seed', s.is_seed,
        'lat', st_y(s.geom::geometry),
        'lng', st_x(s.geom::geometry)
      ) as item
    from scored s
    left join public.departments d on d.id = s.assigned_department_id
  ) q;

  return v_result;
end;
$$;

revoke all on function public.authority_queue(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.authority_queue(jsonb, jsonb) to service_role;

-- Seed tests (02 §5.10, §6, §14; 06 rules 2–3). Requires supabase/seed.sql to have been applied
-- (scripts/db-test/run.sh does that; the file name contains "seed" so SKIP_SEED=1 skips it).
-- Read-only, wrapped in a rolled-back transaction anyway.
begin;

-- DEMO_SPOT from src/config/civic.ts.
create temp table t_spot as
select ST_SetSRID(ST_MakePoint(72.8478, 19.0178), 4326)::geography as g;

-- Risk zones / demo calibration (02 §5.10) --------------------------------------------------------
do $$
declare v int;
begin
  if not exists (select 1 from public.risk_zones z, t_spot s
                 where z.risk_value = 80 and z.name = 'Demo arterial road' and ST_Covers(z.geom, s.g)) then
    raise exception 'risk zone "Demo arterial road" (80) does not contain DEMO_SPOT';
  end if;
  if exists (select 1 from public.risk_zones z, t_spot s where z.risk_value <> 80 and ST_Intersects(z.geom, s.g)) then
    raise exception 'another risk zone contains DEMO_SPOT';
  end if;
  if (select count(*) from public.risk_zones) < 2 then
    raise exception 'expected the demo zone plus other zones';
  end if;
  -- §5.7: location risk = max risk_value of intersecting zones.
  select max(z.risk_value) into v from public.risk_zones z, t_spot s where ST_Intersects(z.geom, s.g);
  if v is distinct from 80 then raise exception 'DEMO_SPOT location risk is %, expected 80', v; end if;
end $$;

-- Clear demo spot (02 §5.10, §14) -----------------------------------------------------------------
do $$ begin
  if exists (select 1 from public.issues i, t_spot s
             where i.category = 'POTHOLE' and i.status <> 'RESOLVED' and ST_DWithin(i.geom, s.g, 50)) then
    raise exception 'unresolved pothole within 50 m of DEMO_SPOT';
  end if;
  if exists (select 1 from public.issues i, t_spot s
             where i.category = 'POTHOLE' and i.status = 'RESOLVED' and i.resolved_at >= now() - interval '90 days'
               and ST_DWithin(i.geom, s.g, 50)) then
    raise exception 'pothole resolved in the last 90 days within 50 m of DEMO_SPOT (recurrence would be > 0)';
  end if;
  if exists (select 1 from public.issues i, t_spot s where i.category = 'POTHOLE' and ST_DWithin(i.geom, s.g, 300)) then
    raise exception 'seeded pothole within 300 m of DEMO_SPOT';
  end if;
  if exists (select 1 from public.issues i, t_spot s where ST_DWithin(i.geom, s.g, 150))
     or exists (select 1 from public.reports r, t_spot s where ST_DWithin(r.geom, s.g, 150)) then
    raise exception 'seeded issue/report within 150 m of DEMO_SPOT (would show up as a duplicate candidate)';
  end if;
end $$;

-- Departments and seed authority ----------------------------------------------------------------
do $$
declare c public.issue_category; n int;
begin
  if (select count(*) from public.departments) <> 5 or exists (select 1 from public.departments where sla_hours <> 72 or not active) then
    raise exception 'expected 5 active departments with sla_hours 72';
  end if;
  foreach c in array array['POTHOLE','FOOTPATH','STREETLIGHT','GARBAGE','WATER_LEAK','DRAINAGE','WATERLOGGING']::public.issue_category[] loop
    select count(*) into n from public.departments where c = any(default_categories);
    if n <> 1 then raise exception 'category % is a default of % departments, expected 1', c, n; end if;
  end loop;
  if not public.is_authority('5eeda000-0000-4000-8000-000000000001') then
    raise exception 'seed authority is not an authority';
  end if;
end $$;

-- Issues and reports --------------------------------------------------------------------------------
do $$
declare n int; bad text;
begin
  select count(*) into n from public.issues;
  if n not between 30 and 45 then raise exception 'issue count % not in 30..45', n; end if;
  if exists (select 1 from public.issues where not is_seed) then raise exception 'non-seed issue in seed'; end if;
  if exists (select 1 from public.issues where created_at > now() or updated_at < created_at) then
    raise exception 'issue timestamps out of order';
  end if;

  -- Every status appears (map/queue demo variety).
  select string_agg(s::text, ', ') into bad
  from unnest(array['REPORTED','ASSIGNED','IN_PROGRESS','RESOLVED','REJECTED','MERGED']::public.issue_status[]) s
  where not exists (select 1 from public.issues i where i.status = s);
  if bad is not null then raise exception 'no seeded issue with status %', bad; end if;

  -- Every non-merged issue has >= 1 report; geom and citizen_severity come from the first report.
  -- (A MERGED issue has none: 02 §3.7 moves all its reports to the target.)
  select string_agg(i.id::text, ', ') into bad
  from public.issues i
  left join lateral (select r.geom, r.citizen_severity, r.created_at from public.reports r
                     where r.issue_id = i.id order by r.created_at, r.id limit 1) f on true
  where i.status <> 'MERGED'
    and (f.geom is null or not ST_Equals(f.geom::geometry, i.geom::geometry)
         or f.citizen_severity is distinct from i.citizen_severity or f.created_at <> i.created_at);
  if bad is not null then raise exception 'issue(s) without a matching first report: %', bad; end if;

  -- Merged issues: no reports left; MERGED_INTO lists reports now on the target, the earliest of
  -- which is the merged issue's own first report.
  select string_agg(i.id::text, ', ') into bad
  from public.issues i
  join public.issue_events e on e.issue_id = i.id and e.event_type = 'MERGED_INTO'
  where i.status = 'MERGED' and (
        exists (select 1 from public.reports r where r.issue_id = i.id)
     or (e.metadata ->> 'target_issue_id')::uuid is distinct from i.merged_into_issue_id
     or not exists (select 1 from public.issue_events f where f.issue_id = i.merged_into_issue_id and f.event_type = 'MERGED_FROM'
                    and (f.metadata ->> 'source_issue_id')::uuid = i.id)
     or exists (select 1 from jsonb_array_elements_text(e.metadata -> 'moved_report_ids') m(rid)
                where not exists (select 1 from public.reports r where r.id = m.rid::uuid and r.issue_id = i.merged_into_issue_id))
     or not (select ST_Equals(r.geom::geometry, i.geom::geometry) and r.created_at = i.created_at
             from public.reports r
             where r.id in (select m.rid::uuid from jsonb_array_elements_text(e.metadata -> 'moved_report_ids') m(rid))
             order by r.created_at limit 1));
  if bad is not null then raise exception 'inconsistent merge on %', bad; end if;
  if exists (select 1 from public.issues s join public.issues t on t.id = s.merged_into_issue_id where t.status = 'MERGED') then
    raise exception 'merge chain in seed';
  end if;

  -- Reports: photo path convention, near their issue, open when filed.
  if exists (select 1 from public.reports r
             where r.image_path !~ ('^' || r.reporter_user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')) then
    raise exception 'report image_path not {reporter}/{uuid}.jpg';
  end if;
  if exists (select 1 from public.reports r join public.issues i on i.id = r.issue_id
             where not ST_DWithin(r.geom, i.geom, 150) or r.created_at < i.created_at or r.created_at > now()) then
    raise exception 'report far from its issue or outside its time range';
  end if;
  if (select count(distinct reporter_user_id) from public.reports) < 5 then
    raise exception 'expected several distinct demo reporters';
  end if;
end $$;

-- Lifecycle columns -------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from public.issues
             where status in ('ASSIGNED', 'IN_PROGRESS')
               and (assigned_at is null or sla_due_at is distinct from assigned_at + interval '72 hours')) then
    raise exception 'ASSIGNED/IN_PROGRESS issue without assigned_at or with sla_due_at <> assigned_at + 72 h';
  end if;
  if exists (select 1 from public.issues i where i.status = 'RESOLVED'
             and not exists (select 1 from public.resolution_evidence e where e.issue_id = i.id)) then
    raise exception 'RESOLVED issue without resolution evidence';
  end if;
  if exists (select 1 from public.resolution_evidence e join public.issues i on i.id = e.issue_id
             where i.status <> 'RESOLVED' or e.uploaded_by <> '5eeda000-0000-4000-8000-000000000001') then
    raise exception 'evidence on a non-resolved issue or not by the seed authority';
  end if;
  if exists (select 1 from public.issues where status = 'REPORTED'
             and (assigned_department_id is not null or assigned_at is not null or resolved_at is not null)) then
    raise exception 'REPORTED issue carries assignment/resolution columns';
  end if;
end $$;

-- Events ------------------------------------------------------------------------------------------
do $$
declare bad text;
begin
  -- Each issue: CREATED (→ REPORTED) is its first event.
  select string_agg(i.id::text, ', ') into bad
  from public.issues i
  where (select e.event_type from public.issue_events e where e.issue_id = i.id order by e.created_at, e.id limit 1)
        is distinct from 'CREATED'
     or (select count(*) from public.issue_events e where e.issue_id = i.id and e.event_type = 'CREATED' and e.to_status = 'REPORTED') <> 1;
  if bad is not null then raise exception 'issue(s) whose first event is not a single CREATED: %', bad; end if;

  -- Status events chain (from = previous to) and end at the current status.
  with s as (
    select e.issue_id, e.event_type, e.from_status, e.to_status,
           lag(e.to_status) over (partition by e.issue_id order by e.created_at, e.id) as prev_to,
           row_number() over (partition by e.issue_id order by e.created_at desc, e.id desc) as rn_desc
    from public.issue_events e where e.to_status is not null
  )
  select string_agg(distinct s.issue_id::text, ', ') into bad
  from s join public.issues i on i.id = s.issue_id
  where s.from_status is distinct from s.prev_to
     or (s.rn_desc = 1 and s.to_status <> i.status);
  if bad is not null then raise exception 'status event chain broken for %', bad; end if;

  -- Non-status events carry no status; each SUPPORT_ADDED matches a report.
  if exists (select 1 from public.issue_events
             where event_type in ('SUPPORT_ADDED', 'SEVERITY_CONFIRMED', 'PRIORITY_SET', 'MERGED_FROM')
               and (from_status is not null or to_status is not null)) then
    raise exception 'non-status event with a status';
  end if;
  if (select count(*) from public.issue_events where event_type = 'SUPPORT_ADDED')
     <> (select count(*) from public.reports) - (select count(*) from public.issues) then
    raise exception 'SUPPORT_ADDED events do not match supporting reports';
  end if;

  -- Lifecycle timestamps match their events.
  if exists (select 1 from public.issues i where i.assigned_at is not null and not exists (
               select 1 from public.issue_events e where e.issue_id = i.id and e.event_type = 'ASSIGNED' and e.created_at = i.assigned_at))
  or exists (select 1 from public.issues i where i.resolved_at is not null and not exists (
               select 1 from public.issue_events e where e.issue_id = i.id and e.event_type = 'RESOLVED' and e.created_at = i.resolved_at)) then
    raise exception 'assigned_at/resolved_at do not match their events';
  end if;
  if exists (select 1 from public.issue_events where event_type = 'REJECTED' and coalesce(note, '') = '') then
    raise exception 'REJECTED without a reason';
  end if;
  if exists (select 1 from public.issue_events e
             where e.actor_user_id is not null and e.event_type not in ('CREATED', 'SUPPORT_ADDED')
               and not public.is_authority(e.actor_user_id)) then
    raise exception 'authority event by a non-authority actor';
  end if;
  if exists (select 1 from public.issues i where i.final_priority is not null and not exists (
               select 1 from public.issue_events e where e.issue_id = i.id and e.event_type = 'PRIORITY_SET'))
  or exists (select 1 from public.issues i where i.authority_severity is not null and not exists (
               select 1 from public.issue_events e where e.issue_id = i.id and e.event_type = 'SEVERITY_CONFIRMED')) then
    raise exception 'priority/severity without its event';
  end if;
end $$;

-- City Pulse precondition (02 §6.2–§6.5): the real §6.3 query on the seed ----------------------------
do $$
declare
  n_clusters int; r record; expected numeric; trend numeric;
begin
  create temp table t_clusters on commit drop as
  with input as (
    select id, category, geom, created_at
    from public.issues
    where status in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED')
      and created_at >= now() - interval '8 hours'
  ), clustered as (
    select input.*,
           ST_ClusterDBSCAN(ST_Transform(geom::geometry, 32643), eps := 300, minpoints := 4)
             over (partition by category) as cid
    from input
  )
  select category, cid,
         count(*) filter (where created_at >= now() - interval '2 hours') as current_count,
         count(*) filter (where created_at <  now() - interval '2 hours') as baseline_count,
         array_agg(id order by id) as members,
         ST_Collect(geom::geometry) as pts
  from clustered
  where cid is not null
  group by category, cid;

  select count(*) into n_clusters from t_clusters;
  if n_clusters <> 1 then raise exception 'expected exactly 1 City Pulse cluster, got %', n_clusters; end if;

  select * into r from t_clusters;
  if r.category <> 'DRAINAGE' then raise exception 'City Pulse cluster is %, expected DRAINAGE', r.category; end if;
  if r.current_count <> 6 then raise exception 'cluster current_count %, expected 6', r.current_count; end if;
  if r.baseline_count > 1 then raise exception 'cluster baseline_count %, expected <= 1', r.baseline_count; end if;
  if r.members <> array[
       '5eed1000-0000-4000-8000-000000000101', '5eed1000-0000-4000-8000-000000000102',
       '5eed1000-0000-4000-8000-000000000103', '5eed1000-0000-4000-8000-000000000104',
       '5eed1000-0000-4000-8000-000000000105', '5eed1000-0000-4000-8000-000000000106',
       '5eed1000-0000-4000-8000-000000000107']::uuid[] then
    raise exception 'unexpected cluster members %', r.members;
  end if;

  expected := r.baseline_count / 3.0;
  trend := (r.current_count - expected) / greatest(expected, 1) * 100;
  if not (trend >= 200 and r.current_count >= 6) then
    raise exception 'cluster would not be CRITICAL: trend % current %', trend, r.current_count;
  end if;

  -- Well away from DEMO_SPOT (02 §14), and the 6 current issues stay in the window for a while
  -- after the seed runs (demo:reset calls regenerate_city_pulse right after).
  if exists (select 1 from t_spot s where ST_DWithin(r.pts::geography, s.g, 5000)) then
    raise exception 'City Pulse cluster within 5 km of DEMO_SPOT';
  end if;
  if (select min(created_at) from public.issues where id = any(r.members) and created_at >= now() - interval '2 hours')
     < now() - interval '110 minutes' then
    raise exception 'oldest current-window issue leaves less than 10 min of margin';
  end if;
end $$;

-- 06 rule 3: hotspots are never seeded ------------------------------------------------------------------
do $$ begin
  if exists (select 1 from public.hotspots) or exists (select 1 from public.hotspot_issues) then
    raise exception 'seed must not contain hotspots';
  end if;
end $$;

rollback;

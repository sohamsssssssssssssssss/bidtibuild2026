-- authority_queue (v1: 20261002001000_authority_workflow.sql; Phase 4 recommended priority:
-- 20261002001200_recommended_priority.sql; 02 §5; 04 §3).
-- Own fixtures (departments d…085x; issues 10000000-…-00000000085N "Q1..Q9" and
-- 10000000-…-000000851NNN for the factor groups; reporters 0…085N / 0…851NNN; risk zones created
-- here), far from the seed. Assertions on membership and order are scoped to them so the seed, when
-- loaded, does not matter; global properties (filters, ordering, row shape) are checked on the whole
-- result. One transaction, rolled back — now() is fixed, so ages are exact.
begin;

create function pg_temp.assert_eq(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception '%: expected % got %', p_label, p_want, p_got; end if;
end $$;
grant execute on function pg_temp.assert_eq(text, anyelement, anyelement) to public;

create function pg_temp.expect_error(p_sql text, p_state text)
returns void language plpgsql as $$
declare raised boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    raised := true;
    if sqlstate <> p_state then
      raise exception 'expected % but got % (%) from: %', p_state, sqlstate, sqlerrm, p_sql;
    end if;
  end;
  if not raised then raise exception 'expected % but statement succeeded: %', p_state, p_sql; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to public;

-- PRIORITY_CONFIG (src/config/civic.ts) as the route passes it; queue_statuses = openStatuses().
create function pg_temp.cfg(p_default text default 'MEDIUM') returns jsonb language sql as $$
  select jsonb_build_object(
    'weights', '{"severity": 0.35, "support": 0.2, "age": 0.15, "location_risk": 0.2, "recurrence": 0.1}'::jsonb,
    'severity_values', '{"LOW": 25, "MEDIUM": 50, "HIGH": 75, "CRITICAL": 100}'::jsonb,
    'default_severity', p_default,
    'factor_max', 100,
    'support_multiplier', 25,
    'age_full_hours', 168,
    'default_location_risk', 25,
    'recurrence_window_days', 90,
    'recurrence_points_per_issue', 50,
    'recurrence_radius_m_by_category', '{"STREETLIGHT": 30, "POTHOLE": 50, "FOOTPATH": 50, "PUBLIC_PROPERTY": 50,
      "OTHER": 50, "GARBAGE": 75, "WATER_LEAK": 75, "DRAINAGE": 150, "WATERLOGGING": 150}'::jsonb,
    'label_thresholds', '{"MEDIUM": 25, "HIGH": 40, "CRITICAL": 55}'::jsonb,
    'queue_statuses', '["REPORTED", "ASSIGNED", "IN_PROGRESS"]'::jsonb)
$$;
grant execute on function pg_temp.cfg(text) to public;

-- cfg() with one path replaced.
create function pg_temp.cfg_set(p_path text[], p_value jsonb) returns jsonb language sql as $$
  select jsonb_set(pg_temp.cfg(), p_path, p_value)
$$;
grant execute on function pg_temp.cfg_set(text[], jsonb) to public;

-- This file's Q issues, in result order, as short labels Q1..Q9.
create function pg_temp.mine(p_result jsonb) returns text[] language sql as $$
  select coalesce(array_agg('Q' || right(e ->> 'id', 1) order by n), '{}')
  from jsonb_array_elements(p_result) with ordinality as t(e, n)
  where e ->> 'id' like '10000000-0000-4000-8000-00000000085_'
$$;
grant execute on function pg_temp.mine(jsonb) to public;

create function pg_temp.elem(p_result jsonb, p_n int) returns jsonb language sql as $$
  select e from jsonb_array_elements(p_result) e where e ->> 'id' = '10000000-0000-4000-8000-00000000085' || p_n
$$;
grant execute on function pg_temp.elem(jsonb, int) to public;

-- Factor-group issue 10000000-…-000000851NNN.
create function pg_temp.x(p_result jsonb, p_nnn text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p_result) e where e ->> 'id' = '10000000-0000-4000-8000-000000851' || p_nnn
$$;
grant execute on function pg_temp.x(jsonb, text) to public;

-- Factor of issue NNN (numeric).
create function pg_temp.f(p_result jsonb, p_nnn text, p_factor text) returns numeric language sql as $$
  select (pg_temp.x(p_result, p_nnn) -> 'factors' ->> p_factor)::numeric
$$;
grant execute on function pg_temp.f(jsonb, text, text) to public;

-- The ordering group (…851bNN), in result order, as 'bNN'.
create function pg_temp.grp_b(p_result jsonb) returns text[] language sql as $$
  select coalesce(array_agg(right(e ->> 'id', 3) order by n), '{}')
  from jsonb_array_elements(p_result) with ordinality as t(e, n)
  where e ->> 'id' like '10000000-0000-4000-8000-000000851b__'
$$;
grant execute on function pg_temp.grp_b(jsonb) to public;

-- Rows (over the whole result) out of order: returned score desc, then created_at asc, then id asc.
create function pg_temp.misordered(p_result jsonb) returns int language sql as $$
  select count(*)::int from (
    select score, created_at, id,
           lag(score) over (order by n) as p_score, lag(created_at) over (order by n) as p_created,
           lag(id) over (order by n) as p_id
    from (
      select n, (x ->> 'score')::numeric as score, (x ->> 'created_at')::timestamptz as created_at, (x ->> 'id')::uuid as id
      from jsonb_array_elements(p_result) with ordinality as t(x, n)
    ) r
  ) o
  where p_score < score
     or (p_score = score and p_created > created_at)
     or (p_score = score and p_created = created_at and p_id > id)
$$;
grant execute on function pg_temp.misordered(jsonb) to public;

-- Privileges -------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg(), '{}')$q$, '42501');
select pg_temp.expect_error($q$select public.priority_label(30, pg_temp.cfg())$q$, '42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg(), '{}')$q$, '42501');
select pg_temp.expect_error($q$select public.priority_label(30, pg_temp.cfg())$q$, '42501');
reset role;
do $$ declare f text; begin
  foreach f in array array['public.authority_queue(jsonb, jsonb)', 'public.priority_label(numeric, jsonb)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute') then
      raise exception '% privileges wrong', f;
    end if;
    if not (select prosecdef and proconfig @> array['search_path=public, extensions'] from pg_proc where oid = f::regprocedure) then
      raise exception '% must be security definer with search_path = public, extensions', f;
    end if;
  end loop;
end $$;

-- Fixtures (superuser) ---------------------------------------------------------------------------
insert into public.departments (id, name, sla_hours) values
  ('d0000000-0000-4000-8000-000000000851', 'Test 085 Dept One', 24),
  ('d0000000-0000-4000-8000-000000000852', 'Test 085 Dept Two', 48);

-- Q1–Q9 (around 72.85, 19.05: outside every zone, no resolved neighbours → location 25, recurrence 0).
-- Scores with cfg(): Q6 40.09 (authority CRITICAL), Q1 39.62 (citizen HIGH, 2 reporters, 5 h),
-- Q5 23.39 (default, 10 h), Q3 22.68 (default, 2 h), Q2 18.84 (authority LOW, 1 reporter),
-- Q4 14.02 (citizen LOW, 3 h). Q7–Q9 are closed.
insert into public.issues (id, category, status, citizen_severity, authority_severity, final_priority,
                           assigned_department_id, assigned_at, sla_due_at, resolved_at, is_seed, geom, created_at) values
  ('10000000-0000-4000-8000-000000000851', 'POTHOLE',     'REPORTED',    'HIGH', null,  null,       null, null, null, null, false, 'SRID=4326;POINT(72.851 19.051)', now() - interval '5 hours'),
  ('10000000-0000-4000-8000-000000000852', 'GARBAGE',     'ASSIGNED',    'HIGH', 'LOW', 'CRITICAL',
   'd0000000-0000-4000-8000-000000000851', now() - interval '30 minutes', now() + interval '23 hours 30 minutes', null, true, 'SRID=4326;POINT(72.852 19.052)', now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000853', 'DRAINAGE',    'IN_PROGRESS', null,   null,  'HIGH',
   'd0000000-0000-4000-8000-000000000852', now() - interval '1 hour', now() + interval '47 hours', null, false, 'SRID=4326;POINT(72.853 19.053)', now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000000854', 'STREETLIGHT', 'REPORTED',    'LOW',  null,  'HIGH',     null, null, null, null, false, 'SRID=4326;POINT(72.854 19.054)', now() - interval '3 hours'),
  ('10000000-0000-4000-8000-000000000855', 'OTHER',       'REPORTED',    null,   null,  'LOW',      null, null, null, null, false, 'SRID=4326;POINT(72.855 19.055)', now() - interval '10 hours'),
  ('10000000-0000-4000-8000-000000000856', 'POTHOLE',     'REPORTED',    null,   'CRITICAL', null,  null, null, null, null, false, 'SRID=4326;POINT(72.856 19.056)', now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000857', 'POTHOLE',     'RESOLVED',    null,   null,  'CRITICAL',
   'd0000000-0000-4000-8000-000000000851', now() - interval '3 days', now(), now() - interval '1 day', false, 'SRID=4326;POINT(72.857 19.057)', now() - interval '4 days'),
  ('10000000-0000-4000-8000-000000000858', 'GARBAGE',     'REJECTED',    null,   null,  'CRITICAL', null, null, null, null, false, 'SRID=4326;POINT(72.858 19.058)', now() - interval '4 days');
insert into public.issues (id, category, status, final_priority, merged_into_issue_id, geom, created_at) values
  ('10000000-0000-4000-8000-000000000859', 'POTHOLE', 'MERGED', 'CRITICAL', '10000000-0000-4000-8000-000000000851', 'SRID=4326;POINT(72.851 19.051)', now() - interval '6 days');

-- Q1: 3 reports from 2 distinct reporters; Q2: 1 report; the others none.
insert into public.reports (issue_id, reporter_user_id, category, description, image_path, geom) values
  ('10000000-0000-4000-8000-000000000851', '00000000-0000-4000-8000-000000000851', 'POTHOLE', 'a', '00000000-0000-4000-8000-000000000851/a.jpg', 'SRID=4326;POINT(72.851 19.051)'),
  ('10000000-0000-4000-8000-000000000851', '00000000-0000-4000-8000-000000000852', 'POTHOLE', 'b', '00000000-0000-4000-8000-000000000852/b.jpg', 'SRID=4326;POINT(72.851 19.051)'),
  ('10000000-0000-4000-8000-000000000851', '00000000-0000-4000-8000-000000000852', 'POTHOLE', 'c', '00000000-0000-4000-8000-000000000852/c.jpg', 'SRID=4326;POINT(72.851 19.051)'),
  ('10000000-0000-4000-8000-000000000852', '00000000-0000-4000-8000-000000000853', 'GARBAGE', 'd', '00000000-0000-4000-8000-000000000853/d.jpg', 'SRID=4326;POINT(72.852 19.052)');

-- Factor groups, east of the city (lng 73.02–73.07), each issue ≥ 1 km from the others' groups.
-- Helper to insert an open OTHER issue (no severity) at (lng, lat), created p_age ago.
create function pg_temp.mk(p_nnn text, p_lng float8, p_lat float8, p_age interval default '0',
                           p_category public.issue_category default 'OTHER', p_status public.issue_status default 'REPORTED',
                           p_resolved_ago interval default null, p_citizen public.level default null)
returns void language sql as $$
  insert into public.issues (id, category, status, citizen_severity, geom, created_at, resolved_at)
  values (('10000000-0000-4000-8000-000000851' || p_nnn)::uuid, p_category, p_status, p_citizen,
          st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, now() - p_age, now() - p_resolved_ago)
$$;

-- Support (lat 18.90): 101 one reporter; 102 two; 103 four reports from three (one reporter twice);
-- 107 seven distinct; 100 none.
select pg_temp.mk('100', 73.01, 18.90), pg_temp.mk('101', 73.02, 18.90), pg_temp.mk('102', 73.03, 18.90),
       pg_temp.mk('103', 73.04, 18.90), pg_temp.mk('107', 73.05, 18.90);
insert into public.reports (issue_id, reporter_user_id, category, description, image_path, geom)
select ('10000000-0000-4000-8000-000000851' || s.nnn)::uuid,
       ('00000000-0000-4000-8000-000000851' || s.reporter)::uuid,
       'OTHER', 'support fixture', s.reporter || '/x.jpg', 'SRID=4326;POINT(73.03 18.90)'
from (values ('101', '001'),
             ('102', '001'), ('102', '002'),
             ('103', '001'), ('103', '002'), ('103', '003'), ('103', '002'),
             ('107', '001'), ('107', '002'), ('107', '003'), ('107', '004'), ('107', '005'), ('107', '006'), ('107', '007')
     ) as s (nnn, reporter);

-- Age (lat 18.91): 0 h, 84 h (= 50), 168 h (= 100), 400 h (capped 100), created 1 h in the future (0).
select pg_temp.mk('200', 73.02, 18.91), pg_temp.mk('284', 73.03, 18.91, '84 hours'),
       pg_temp.mk('368', 73.04, 18.91, '168 hours'), pg_temp.mk('399', 73.05, 18.91, '400 hours'),
       pg_temp.mk('201', 73.06, 18.91, '-1 hour');

-- Location risk (lat 18.92): zones 40 (500 m) and 90 (100 m) around (73.02, 18.92), 0 (100 m) around
-- (73.07, 18.92). 301 in both → 90; 302 ~295 m east, only in the 40 → 40; 303 in none → default;
-- 304 only in the 0 zone → 0 (not the default).
insert into public.risk_zones (name, risk_value, geom) values
  ('Test 085 wide', 40, st_buffer('SRID=4326;POINT(73.02 18.92)'::geography, 500)::geography(Polygon, 4326)),
  ('Test 085 core', 90, st_buffer('SRID=4326;POINT(73.02 18.92)'::geography, 100)::geography(Polygon, 4326)),
  ('Test 085 zero',  0, st_buffer('SRID=4326;POINT(73.07 18.92)'::geography, 100)::geography(Polygon, 4326));
select pg_temp.mk('301', 73.02, 18.92), pg_temp.mk('302', 73.0228, 18.92), pg_temp.mk('303', 73.05, 18.92),
       pg_temp.mk('304', 73.07, 18.92);

-- Recurrence (lat 18.93; 0.00009° lat ≈ 10 m). Targets 400–403 are open POTHOLEs with 0/1/2/3
-- counted neighbours (RESOLVED POTHOLE, ≤ 50 m, resolved ≤ 90 days ago). 400's neighbours all fail
-- one rule: 60 m away; GARBAGE; resolved 91 days ago; REJECTED. 404 is DRAINAGE (radius 150): a
-- resolved DRAINAGE 120 m away counts, a resolved WATERLOGGING 20 m away (same family) does not.
select pg_temp.mk('400', 73.02, 18.93, '1 hour', 'POTHOLE'),
       pg_temp.mk('a01', 73.02, 18.93054, '30 days', 'POTHOLE', 'RESOLVED', '5 days'),
       pg_temp.mk('a02', 73.02, 18.93009, '30 days', 'GARBAGE', 'RESOLVED', '5 days'),
       pg_temp.mk('a03', 73.02, 18.92991, '120 days', 'POTHOLE', 'RESOLVED', '91 days'),
       pg_temp.mk('a04', 73.02, 18.93018, '30 days', 'POTHOLE', 'REJECTED', '1 day'),
       pg_temp.mk('401', 73.03, 18.93, '1 hour', 'POTHOLE'),
       pg_temp.mk('a11', 73.03, 18.93018, '30 days', 'POTHOLE', 'RESOLVED', '10 days'),
       pg_temp.mk('402', 73.04, 18.93, '1 hour', 'POTHOLE'),
       pg_temp.mk('a21', 73.04, 18.93018, '30 days', 'POTHOLE', 'RESOLVED', '10 days'),
       pg_temp.mk('a22', 73.04, 18.92982, '30 days', 'POTHOLE', 'RESOLVED', '89 days'),
       pg_temp.mk('403', 73.05, 18.93, '1 hour', 'POTHOLE'),
       pg_temp.mk('a31', 73.05, 18.93018, '30 days', 'POTHOLE', 'RESOLVED', '10 days'),
       pg_temp.mk('a32', 73.05, 18.92982, '30 days', 'POTHOLE', 'RESOLVED', '1 day'),
       pg_temp.mk('a33', 73.05, 18.93036, '30 days', 'POTHOLE', 'RESOLVED', '2 days'),
       pg_temp.mk('404', 73.06, 18.93, '1 hour', 'DRAINAGE'),
       pg_temp.mk('a41', 73.06, 18.93108, '30 days', 'DRAINAGE', 'RESOLVED', '10 days'),
       pg_temp.mk('a42', 73.06, 18.93018, '30 days', 'WATERLOGGING', 'RESOLVED', '10 days');

-- Ordering (lat 18.94): equal inputs except created_at / id; b04 is newer but citizen HIGH.
select pg_temp.mk('b01', 73.02, 18.94, '2 hours'), pg_temp.mk('b02', 73.03, 18.94, '1 hour'),
       pg_temp.mk('b03', 73.04, 18.94, '2 hours'), pg_temp.mk('b04', 73.05, 18.94, '1 hour', p_citizen => 'HIGH');

set local role service_role;
do $$
declare res jsonb; e jsonb; bad int;
begin
  -- Default statuses (p_config.queue_statuses), for every "no filter" spelling ----------------------
  foreach e in array array[null, '{}', '{"statuses": null, "categories": null, "department_id": null, "unassigned_only": false}']::jsonb[] loop
    res := public.authority_queue(pg_temp.cfg(), e);
    perform pg_temp.assert_eq('default: array', jsonb_typeof(res), 'array');
    perform pg_temp.assert_eq('default: mine, score order (filters ' || coalesce(e::text, 'null') || ')',
      pg_temp.mine(res), array['Q6', 'Q1', 'Q5', 'Q3', 'Q2', 'Q4']);
    select count(*) into bad from jsonb_array_elements(res) x where x ->> 'status' not in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS');
    perform pg_temp.assert_eq('default: no closed issue at all', bad, 0);
  end loop;
  perform pg_temp.assert_eq('default: every open issue once',
    jsonb_array_length(res), (select count(*)::int from public.issues where status in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS')));

  -- Order over the whole result: returned score desc, then created_at asc, then id
  perform pg_temp.assert_eq('global score ordering', pg_temp.misordered(res), 0);

  -- Row shape --------------------------------------------------------------------------------------
  select count(*) into bad from jsonb_array_elements(res) x
  where (select array_agg(k order by k collate "C") from jsonb_object_keys(x) k) is distinct from
        (select array_agg(k order by k collate "C") from unnest(array[
          'id', 'category', 'status', 'final_priority', 'effective_severity', 'severity_source', 'factors', 'score',
          'label', 'distinct_reporter_count', 'recurrence_count', 'report_count', 'department', 'sla_due_at',
          'created_at', 'updated_at', 'is_seed', 'lat', 'lng']) k);
  perform pg_temp.assert_eq('every row has exactly the contract keys', bad, 0);
  -- Phase 4: factors / score / label / recurrence_count populated on every row
  select count(*) into bad from jsonb_array_elements(res) x
  where jsonb_typeof(x -> 'factors') is distinct from 'object'
     or (select array_agg(k order by k collate "C") from jsonb_object_keys(x -> 'factors') k)
          is distinct from array['age', 'location_risk', 'recurrence', 'severity', 'support']
     or exists (select 1 from jsonb_each(x -> 'factors') f
                where jsonb_typeof(f.value) <> 'number' or (f.value)::numeric < 0 or (f.value)::numeric > 100
                   or (f.value)::numeric <> round((f.value)::numeric, 2))
     or jsonb_typeof(x -> 'score') is distinct from 'number'
     or (x ->> 'score')::numeric <> round((x ->> 'score')::numeric, 2)
     or x ->> 'label' is null or x ->> 'label' not in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
     or jsonb_typeof(x -> 'recurrence_count') is distinct from 'number'
     or (x ->> 'recurrence_count')::numeric <> trunc((x ->> 'recurrence_count')::numeric)
     or (x ->> 'recurrence_count')::numeric < 0;
  perform pg_temp.assert_eq('factors / score / label / recurrence_count populated and well-formed', bad, 0);
  -- score = Σ weight × factor, within rounding of the five rounded factors
  select count(*) into bad from jsonb_array_elements(res) x
  where abs((x ->> 'score')::numeric - (0.35 * (x -> 'factors' ->> 'severity')::numeric + 0.2 * (x -> 'factors' ->> 'support')::numeric
            + 0.15 * (x -> 'factors' ->> 'age')::numeric + 0.2 * (x -> 'factors' ->> 'location_risk')::numeric
            + 0.1 * (x -> 'factors' ->> 'recurrence')::numeric)) > 0.01;
  perform pg_temp.assert_eq('score is the weighted sum of the factors', bad, 0);

  -- No reporter ids anywhere (06 rule 22)
  perform pg_temp.assert_eq('no reporter ids in output',
    res::text ~ '00000000-0000-4000-8000-00000000085[123]|00000000-0000-4000-8000-000000851|5eedc000-', false);
  perform pg_temp.assert_eq('no reporter keys', res::text ~ 'reporter_user_id|reporter_ip_hash|actor_user_id', false);

  -- Q1: CITIZEN severity, counts, no department, every factor
  e := pg_temp.elem(res, 1);
  perform pg_temp.assert_eq('Q1 row', e - 'created_at' - 'updated_at' - 'lat' - 'lng', jsonb_build_object(
    'id', '10000000-0000-4000-8000-000000000851', 'category', 'POTHOLE', 'status', 'REPORTED', 'final_priority', null,
    'effective_severity', 'HIGH', 'severity_source', 'CITIZEN',
    'factors', jsonb_build_object('severity', 75, 'support', 39.62, 'age', 2.98, 'location_risk', 25, 'recurrence', 0),
    'score', 39.62, 'label', 'MEDIUM',
    'distinct_reporter_count', 2, 'recurrence_count', 0, 'report_count', 3, 'department', null, 'sla_due_at', null,
    'is_seed', false));
  perform pg_temp.assert_eq('Q1 created_at', (e ->> 'created_at')::timestamptz, now() - interval '5 hours');
  perform pg_temp.assert_eq('Q1 updated_at', (e ->> 'updated_at')::timestamptz, now());
  perform pg_temp.assert_eq('Q1 lat', round((e ->> 'lat')::numeric, 6), 19.051);
  perform pg_temp.assert_eq('Q1 lng', round((e ->> 'lng')::numeric, 6), 72.851);

  -- Q2: AUTHORITY severity wins over citizen (factor 25, not 75); department; sla; is_seed
  e := pg_temp.elem(res, 2);
  perform pg_temp.assert_eq('Q2 severity', e ->> 'effective_severity', 'LOW');
  perform pg_temp.assert_eq('Q2 source', e ->> 'severity_source', 'AUTHORITY');
  perform pg_temp.assert_eq('Q2 severity factor (authority over citizen)', (e -> 'factors' ->> 'severity')::numeric, 25::numeric);
  perform pg_temp.assert_eq('Q2 score', (e ->> 'score')::numeric, 18.84);
  perform pg_temp.assert_eq('Q2 label', e ->> 'label', 'LOW');
  perform pg_temp.assert_eq('Q2 department', e -> 'department', '{"id": "d0000000-0000-4000-8000-000000000851", "name": "Test 085 Dept One"}'::jsonb);
  perform pg_temp.assert_eq('Q2 sla_due_at', (e ->> 'sla_due_at')::timestamptz, now() + interval '23 hours 30 minutes');
  perform pg_temp.assert_eq('Q2 counts', (e ->> 'report_count') || '/' || (e ->> 'distinct_reporter_count'), '1/1');
  perform pg_temp.assert_eq('Q2 is_seed', e -> 'is_seed', 'true'::jsonb);

  -- Q3: DEFAULT severity (from p_config), zero counts → support 0
  e := pg_temp.elem(res, 3);
  perform pg_temp.assert_eq('Q3 severity', e ->> 'effective_severity', 'MEDIUM');
  perform pg_temp.assert_eq('Q3 source', e ->> 'severity_source', 'DEFAULT');
  perform pg_temp.assert_eq('Q3 counts', (e ->> 'report_count') || '/' || (e ->> 'distinct_reporter_count'), '0/0');
  perform pg_temp.assert_eq('Q3 factors', e -> 'factors',
    jsonb_build_object('severity', 50, 'support', 0, 'age', 1.19, 'location_risk', 25, 'recurrence', 0));
  -- Q6: AUTHORITY without citizen severity
  perform pg_temp.assert_eq('Q6 source', pg_temp.elem(res, 6) ->> 'severity_source', 'AUTHORITY');
  perform pg_temp.assert_eq('Q6 severity', pg_temp.elem(res, 6) ->> 'effective_severity', 'CRITICAL');
  perform pg_temp.assert_eq('Q6 score / label', (pg_temp.elem(res, 6) ->> 'score') || ' ' || (pg_temp.elem(res, 6) ->> 'label'), '40.09 HIGH');

  -- default_severity is read from p_config
  res := public.authority_queue(pg_temp.cfg('LOW'), '{}');
  perform pg_temp.assert_eq('config default severity', pg_temp.elem(res, 3) ->> 'effective_severity', 'LOW');
  perform pg_temp.assert_eq('config default source', pg_temp.elem(res, 3) ->> 'severity_source', 'DEFAULT');
  perform pg_temp.assert_eq('config default severity factor', (pg_temp.elem(res, 3) -> 'factors' ->> 'severity')::numeric, 25::numeric);
  perform pg_temp.assert_eq('citizen severity unaffected by default', pg_temp.elem(res, 1) ->> 'effective_severity', 'HIGH');

  -- queue_statuses is read from p_config
  res := public.authority_queue(jsonb_set(pg_temp.cfg(), '{queue_statuses}', '["IN_PROGRESS"]'), '{}');
  perform pg_temp.assert_eq('config statuses', pg_temp.mine(res), array['Q3']);

  -- Filters ----------------------------------------------------------------------------------------
  -- Q9 35.36 (6 days old), Q7 = Q8 31.07 (same created_at → id)
  res := public.authority_queue(pg_temp.cfg(), '{"statuses": ["RESOLVED", "REJECTED", "MERGED"]}');
  perform pg_temp.assert_eq('statuses filter (closed)', pg_temp.mine(res), array['Q9', 'Q7', 'Q8']);
  select count(*) into bad from jsonb_array_elements(res) x where x ->> 'status' not in ('RESOLVED', 'REJECTED', 'MERGED');
  perform pg_temp.assert_eq('statuses filter: global', bad, 0);
  perform pg_temp.assert_eq('closed: global ordering', pg_temp.misordered(res), 0);

  res := public.authority_queue(pg_temp.cfg(), '{"statuses": ["REPORTED"]}');
  perform pg_temp.assert_eq('statuses filter REPORTED', pg_temp.mine(res), array['Q6', 'Q1', 'Q5', 'Q4']);

  res := public.authority_queue(pg_temp.cfg(), '{"statuses": []}');
  perform pg_temp.assert_eq('empty statuses → empty result', res, '[]'::jsonb);

  res := public.authority_queue(pg_temp.cfg(), '{"categories": ["POTHOLE", "DRAINAGE"]}');
  perform pg_temp.assert_eq('categories filter', pg_temp.mine(res), array['Q6', 'Q1', 'Q3']);
  select count(*) into bad from jsonb_array_elements(res) x
  where x ->> 'category' not in ('POTHOLE', 'DRAINAGE') or x ->> 'status' not in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS');
  perform pg_temp.assert_eq('categories filter: global (and default statuses)', bad, 0);

  res := public.authority_queue(pg_temp.cfg(), '{"department_id": "d0000000-0000-4000-8000-000000000851"}');
  perform pg_temp.assert_eq('department filter: only Q2 at all', res, jsonb_build_array(pg_temp.elem(res, 2)));
  res := public.authority_queue(pg_temp.cfg(), '{"department_id": "d0000000-0000-4000-8000-000000000851", "statuses": ["RESOLVED"]}');
  perform pg_temp.assert_eq('department + statuses', pg_temp.mine(res), array['Q7']);

  res := public.authority_queue(pg_temp.cfg(), '{"unassigned_only": true}');
  perform pg_temp.assert_eq('unassigned_only', pg_temp.mine(res), array['Q6', 'Q1', 'Q5', 'Q4']);
  select count(*) into bad from jsonb_array_elements(res) x where x -> 'department' <> 'null';
  perform pg_temp.assert_eq('unassigned_only: global', bad, 0);

  res := public.authority_queue(pg_temp.cfg(),
    '{"statuses": ["REPORTED", "ASSIGNED"], "categories": ["POTHOLE", "GARBAGE"], "department_id": null, "unassigned_only": true}');
  perform pg_temp.assert_eq('combined filters', pg_temp.mine(res), array['Q6', 'Q1']);

  -- A bad config is a programming error (route → INTERNAL), not a client error
  perform pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg() - 'queue_statuses', '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg() - 'default_severity', '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue(null, '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg() #- '{weights,age}', '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg() #- '{severity_values,CRITICAL}', '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg() #- '{recurrence_radius_m_by_category,DRAINAGE}', '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg() #- '{label_thresholds,HIGH}', '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg() - 'factor_max', '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg_set('{age_full_hours}', '0'), '{}')$q$, '22023');

  perform pg_temp.assert_eq('volatility stable', (select provolatile from pg_proc where oid = 'public.authority_queue(jsonb, jsonb)'::regprocedure), 's'::"char");
end $$;

-- Factors, one at a time (02 §5.4–5.8) ------------------------------------------------------------
do $$
declare res jsonb;
begin
  res := public.authority_queue(pg_temp.cfg(), '{}');

  -- Support: 25 * log2(1 + distinct reporters); the same reporter twice counts once
  perform pg_temp.assert_eq('support 0 reporters', pg_temp.f(res, '100', 'support'), 0::numeric);
  perform pg_temp.assert_eq('support 1 reporter', pg_temp.f(res, '101', 'support'), 25::numeric);
  perform pg_temp.assert_eq('support 2 reporters', pg_temp.f(res, '102', 'support'), 39.62);
  perform pg_temp.assert_eq('support 3 distinct of 4 reports', pg_temp.f(res, '103', 'support'), 50::numeric);
  perform pg_temp.assert_eq('103 counts', (pg_temp.x(res, '103') ->> 'report_count') || '/' || (pg_temp.x(res, '103') ->> 'distinct_reporter_count'), '4/3');
  perform pg_temp.assert_eq('support 7 reporters', pg_temp.f(res, '107', 'support'), 75::numeric);
  perform pg_temp.assert_eq('107 score (17.5 + 15 + 0 + 5 + 0)', (pg_temp.x(res, '107') ->> 'score')::numeric, 37.5);

  -- Age: hours / 168 * 100, capped at 100, never negative
  perform pg_temp.assert_eq('age 0 h', pg_temp.f(res, '200', 'age'), 0::numeric);
  perform pg_temp.assert_eq('age 84 h', pg_temp.f(res, '284', 'age'), 50::numeric);
  perform pg_temp.assert_eq('age 168 h', pg_temp.f(res, '368', 'age'), 100::numeric);
  perform pg_temp.assert_eq('age 400 h capped', pg_temp.f(res, '399', 'age'), 100::numeric);
  perform pg_temp.assert_eq('age future created_at', pg_temp.f(res, '201', 'age'), 0::numeric);
  perform pg_temp.assert_eq('284 score (17.5 + 0 + 7.5 + 5)', (pg_temp.x(res, '284') ->> 'score')::numeric, 30::numeric);

  -- Location risk: max of overlapping zones, else default; a 0 zone is 0, not the default
  perform pg_temp.assert_eq('location in 40 + 90 zones', pg_temp.f(res, '301', 'location_risk'), 90::numeric);
  perform pg_temp.assert_eq('location in 40 zone only', pg_temp.f(res, '302', 'location_risk'), 40::numeric);
  perform pg_temp.assert_eq('location outside zones', pg_temp.f(res, '303', 'location_risk'), 25::numeric);
  perform pg_temp.assert_eq('location in a 0 zone', pg_temp.f(res, '304', 'location_risk'), 0::numeric);

  -- Recurrence: 50 per resolved same-category issue within radius in the window, capped at 100
  perform pg_temp.assert_eq('recurrence count 0 (60 m / GARBAGE / 91 days / REJECTED excluded)',
    (pg_temp.x(res, '400') ->> 'recurrence_count')::int, 0);
  perform pg_temp.assert_eq('recurrence 0', pg_temp.f(res, '400', 'recurrence'), 0::numeric);
  perform pg_temp.assert_eq('recurrence count 1', (pg_temp.x(res, '401') ->> 'recurrence_count')::int, 1);
  perform pg_temp.assert_eq('recurrence 1 → 50', pg_temp.f(res, '401', 'recurrence'), 50::numeric);
  perform pg_temp.assert_eq('recurrence count 2', (pg_temp.x(res, '402') ->> 'recurrence_count')::int, 2);
  perform pg_temp.assert_eq('recurrence 2 → 100', pg_temp.f(res, '402', 'recurrence'), 100::numeric);
  perform pg_temp.assert_eq('recurrence count 3', (pg_temp.x(res, '403') ->> 'recurrence_count')::int, 3);
  perform pg_temp.assert_eq('recurrence 3 → capped 100', pg_temp.f(res, '403', 'recurrence'), 100::numeric);
  perform pg_temp.assert_eq('DRAINAGE: 120 m same category counts, family mate does not',
    (pg_temp.x(res, '404') ->> 'recurrence_count')::int, 1);
  perform pg_temp.assert_eq('401 score (17.5 + 0 + 0.09 + 5 + 5)', (pg_temp.x(res, '401') ->> 'score')::numeric, 27.59);

  -- A resolved issue does not count itself (a11 is alone; a31's two neighbours count)
  res := public.authority_queue(pg_temp.cfg(), '{"statuses": ["RESOLVED"]}');
  perform pg_temp.assert_eq('resolved issue: not itself', (pg_temp.x(res, 'a11') ->> 'recurrence_count')::int, 0);
  perform pg_temp.assert_eq('resolved issue: its neighbours', (pg_temp.x(res, 'a31') ->> 'recurrence_count')::int, 2);
end $$;

-- Every number from p_config ----------------------------------------------------------------------
do $$
declare res jsonb;
begin
  -- weights: swap severity and location_risk weights → 301 (default 50, risk 90) 35.5 → 41.5
  perform pg_temp.assert_eq('301 score default weights',
    (pg_temp.x(public.authority_queue(pg_temp.cfg(), '{}'), '301') ->> 'score')::numeric, 35.5);
  res := public.authority_queue(pg_temp.cfg_set('{weights}',
    '{"severity": 0.2, "support": 0.2, "age": 0.15, "location_risk": 0.35, "recurrence": 0.1}'), '{}');
  perform pg_temp.assert_eq('301 score swapped weights', (pg_temp.x(res, '301') ->> 'score')::numeric, 41.5);
  perform pg_temp.assert_eq('301 label swapped weights', pg_temp.x(res, '301') ->> 'label', 'HIGH');
  -- support only
  res := public.authority_queue(pg_temp.cfg_set('{weights}',
    '{"severity": 0, "support": 1, "age": 0, "location_risk": 0, "recurrence": 0}'), '{}');
  perform pg_temp.assert_eq('support-only score', (pg_temp.x(res, '107') ->> 'score')::numeric, 75::numeric);
  perform pg_temp.assert_eq('support-only label', pg_temp.x(res, '107') ->> 'label', 'CRITICAL');
  perform pg_temp.assert_eq('support-only order', pg_temp.grp_b(res) || pg_temp.mine(res), array['b01', 'b03', 'b02', 'b04', 'Q1', 'Q2', 'Q5', 'Q4', 'Q3', 'Q6']);
  -- recurrence weight
  res := public.authority_queue(pg_temp.cfg_set('{weights,recurrence}', '0.5'), '{}');
  perform pg_temp.assert_eq('recurrence weight', (pg_temp.x(res, '401') ->> 'score')::numeric, 47.59);

  -- severity_values
  res := public.authority_queue(pg_temp.cfg_set('{severity_values,HIGH}', '80'), '{}');
  perform pg_temp.assert_eq('severity_values HIGH', (pg_temp.elem(res, 1) -> 'factors' ->> 'severity')::numeric, 80::numeric);

  -- factor_max caps support, age and recurrence
  res := public.authority_queue(pg_temp.cfg_set('{factor_max}', '60'), '{}');
  perform pg_temp.assert_eq('factor_max support', pg_temp.f(res, '107', 'support'), 60::numeric);
  perform pg_temp.assert_eq('factor_max age 84 h', pg_temp.f(res, '284', 'age'), 30::numeric);
  perform pg_temp.assert_eq('factor_max age capped', pg_temp.f(res, '399', 'age'), 60::numeric);
  perform pg_temp.assert_eq('factor_max recurrence', pg_temp.f(res, '402', 'recurrence'), 60::numeric);

  -- support_multiplier (and the factor_max cap on support)
  res := public.authority_queue(pg_temp.cfg_set('{support_multiplier}', '40'), '{}');
  perform pg_temp.assert_eq('support_multiplier', pg_temp.f(res, '101', 'support'), 40::numeric);
  perform pg_temp.assert_eq('support capped at factor_max', pg_temp.f(res, '107', 'support'), 100::numeric);

  -- age_full_hours
  res := public.authority_queue(pg_temp.cfg_set('{age_full_hours}', '84'), '{}');
  perform pg_temp.assert_eq('age_full_hours', pg_temp.f(res, '284', 'age'), 100::numeric);

  -- default_location_risk (a zone hit keeps its own value)
  res := public.authority_queue(pg_temp.cfg_set('{default_location_risk}', '10'), '{}');
  perform pg_temp.assert_eq('default_location_risk', pg_temp.f(res, '303', 'location_risk'), 10::numeric);
  perform pg_temp.assert_eq('zone value not the default', pg_temp.f(res, '304', 'location_risk'), 0::numeric);

  -- recurrence_points_per_issue
  res := public.authority_queue(pg_temp.cfg_set('{recurrence_points_per_issue}', '30'), '{}');
  perform pg_temp.assert_eq('points per issue ×2', pg_temp.f(res, '402', 'recurrence'), 60::numeric);
  perform pg_temp.assert_eq('points per issue ×3', pg_temp.f(res, '403', 'recurrence'), 90::numeric);

  -- recurrence_window_days: 120 includes a03 (91 days); 60 drops a22 (89 days)
  res := public.authority_queue(pg_temp.cfg_set('{recurrence_window_days}', '120'), '{}');
  perform pg_temp.assert_eq('window 120: 91-day-old counts', (pg_temp.x(res, '400') ->> 'recurrence_count')::int, 1);
  res := public.authority_queue(pg_temp.cfg_set('{recurrence_window_days}', '60'), '{}');
  perform pg_temp.assert_eq('window 60: 89-day-old dropped', (pg_temp.x(res, '402') ->> 'recurrence_count')::int, 1);

  -- recurrence_radius_m_by_category: POTHOLE 70 includes a01 (60 m); DRAINAGE 100 drops a41 (120 m)
  res := public.authority_queue(pg_temp.cfg_set('{recurrence_radius_m_by_category,POTHOLE}', '70'), '{}');
  perform pg_temp.assert_eq('radius 70: 60 m counts', (pg_temp.x(res, '400') ->> 'recurrence_count')::int, 1);
  res := public.authority_queue(pg_temp.cfg_set('{recurrence_radius_m_by_category,DRAINAGE}', '100'), '{}');
  perform pg_temp.assert_eq('radius 100: 120 m dropped', (pg_temp.x(res, '404') ->> 'recurrence_count')::int, 0);

  -- label_thresholds
  res := public.authority_queue(pg_temp.cfg_set('{label_thresholds}', '{"MEDIUM": 10, "HIGH": 20, "CRITICAL": 39}'), '{}');
  perform pg_temp.assert_eq('thresholds: Q1 39.62', pg_temp.elem(res, 1) ->> 'label', 'CRITICAL');
  perform pg_temp.assert_eq('thresholds: Q2 18.84', pg_temp.elem(res, 2) ->> 'label', 'MEDIUM');
  perform pg_temp.assert_eq('thresholds: Q4 14.02', pg_temp.elem(res, 4) ->> 'label', 'MEDIUM');

  -- The label uses the unrounded score: Q6 = 100 × 0.24996 = 24.996 → shown 25.00 but LOW
  res := public.authority_queue(pg_temp.cfg_set('{weights}',
    '{"severity": 0.24996, "support": 0, "age": 0, "location_risk": 0, "recurrence": 0}'), '{}');
  perform pg_temp.assert_eq('rounded score', (pg_temp.elem(res, 6) ->> 'score')::numeric, 25::numeric);
  perform pg_temp.assert_eq('label from unrounded score', pg_temp.elem(res, 6) ->> 'label', 'LOW');
  res := public.authority_queue(pg_temp.cfg_set('{weights}',
    '{"severity": 0.25, "support": 0, "age": 0, "location_risk": 0, "recurrence": 0}'), '{}');
  perform pg_temp.assert_eq('exactly 25 → MEDIUM', pg_temp.elem(res, 6) ->> 'label', 'MEDIUM');
end $$;

-- priority_label boundaries (02 §5.9; lower bounds inclusive) --------------------------------------
do $$
declare s numeric; want text;
begin
  for s, want in select * from (values
      (0::numeric, 'LOW'), (24.99, 'LOW'), (24.999999, 'LOW'), (25, 'MEDIUM'), (39.99, 'MEDIUM'), (40, 'HIGH'),
      (54.99, 'HIGH'), (55, 'CRITICAL'), (100, 'CRITICAL'), (-1, 'LOW')) v loop
    perform pg_temp.assert_eq('priority_label(' || s || ')', public.priority_label(s, pg_temp.cfg())::text, want);
  end loop;
  perform pg_temp.assert_eq('priority_label(null)', public.priority_label(null, pg_temp.cfg()), null::public.level);
  perform pg_temp.assert_eq('priority_label config-driven',
    public.priority_label(30, pg_temp.cfg_set('{label_thresholds}', '{"MEDIUM": 10, "HIGH": 30, "CRITICAL": 31}'))::text, 'HIGH');
  perform pg_temp.assert_eq('priority_label config-driven (below MEDIUM)',
    public.priority_label(30, pg_temp.cfg_set('{label_thresholds,MEDIUM}', '31'))::text, 'LOW');
  perform pg_temp.expect_error($q$select public.priority_label(30, '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.priority_label(30, pg_temp.cfg() #- '{label_thresholds,CRITICAL}')$q$, '22023');
  perform pg_temp.assert_eq('priority_label immutable',
    (select provolatile from pg_proc where oid = 'public.priority_label(numeric, jsonb)'::regprocedure), 'i'::"char");
end $$;

-- Ordering: score desc, then created_at asc, then id ---------------------------------------------
do $$
declare res jsonb;
begin
  -- Default weights: b04 (citizen HIGH, newer) first; b01/b03 (2 h) before b02 (1 h); b01 before b03 by id.
  res := public.authority_queue(pg_temp.cfg(), '{}');
  perform pg_temp.assert_eq('order by score', pg_temp.grp_b(res), array['b04', 'b01', 'b03', 'b02']);
  -- Age weight 0: b01, b02, b03 tie on score → oldest first, then id
  res := public.authority_queue(pg_temp.cfg_set('{weights,age}', '0'), '{}');
  perform pg_temp.assert_eq('tie → created_at, id', pg_temp.grp_b(res), array['b04', 'b01', 'b03', 'b02']);
  perform pg_temp.assert_eq('tie scores equal',
    (pg_temp.x(res, 'b01') ->> 'score') || (pg_temp.x(res, 'b02') ->> 'score') || (pg_temp.x(res, 'b03') ->> 'score'), '22.5022.5022.50');
  perform pg_temp.assert_eq('age weight 0: global ordering', pg_temp.misordered(res), 0);
end $$;
reset role;

rollback;

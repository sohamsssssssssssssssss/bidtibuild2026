-- authority_queue v1 (20261002001000_authority_workflow.sql; 02 §5.1, §5.4; 04 §3).
-- Own fixtures (departments d…085x, issues 10000000-…-00000000085N, reporters 0…085N); assertions on
-- membership and order are scoped to them so the seed, when loaded, does not matter; global
-- properties (status/category/department filters, ordering) are checked on the whole result.
-- One transaction, rolled back.
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

-- PRIORITY_CONFIG subset that v1 reads (queue_statuses = openStatuses() with reopen off).
create function pg_temp.cfg(p_default text default 'MEDIUM') returns jsonb language sql as $$
  select jsonb_build_object('queue_statuses', '["REPORTED", "ASSIGNED", "IN_PROGRESS"]'::jsonb,
                            'default_severity', p_default,
                            'weights', '{"severity": 0.35}'::jsonb)
$$;
grant execute on function pg_temp.cfg(text) to public;

-- This file's issues, in result order, as short labels Q1..Q9.
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

-- Privileges -------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg(), '{}')$q$, '42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.authority_queue(pg_temp.cfg(), '{}')$q$, '42501');
reset role;

-- Fixtures (superuser) ---------------------------------------------------------------------------
insert into public.departments (id, name, sla_hours) values
  ('d0000000-0000-4000-8000-000000000851', 'Test 085 Dept One', 24),
  ('d0000000-0000-4000-8000-000000000852', 'Test 085 Dept Two', 48);

-- Expected v1 order of the open ones: Q2 (CRITICAL), Q4 (HIGH, 3 h), Q3 (HIGH, 2 h), Q5 (LOW),
-- Q1 (unset, 5 h), Q6 (unset, 1 h). Q7–Q9 are closed.
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

set local role service_role;
do $$
declare res jsonb; e jsonb; bad int;
begin
  -- Default statuses (p_config.queue_statuses), for every "no filter" spelling ----------------------
  foreach e in array array[null, '{}', '{"statuses": null, "categories": null, "department_id": null, "unassigned_only": false}']::jsonb[] loop
    res := public.authority_queue(pg_temp.cfg(), e);
    perform pg_temp.assert_eq('default: array', jsonb_typeof(res), 'array');
    perform pg_temp.assert_eq('default: mine, v1 order (filters ' || coalesce(e::text, 'null') || ')',
      pg_temp.mine(res), array['Q2', 'Q4', 'Q3', 'Q5', 'Q1', 'Q6']);
    select count(*) into bad from jsonb_array_elements(res) x where x ->> 'status' not in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS');
    perform pg_temp.assert_eq('default: no closed issue at all', bad, 0);
  end loop;
  perform pg_temp.assert_eq('default: every open issue once',
    jsonb_array_length(res), (select count(*)::int from public.issues where status in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS')));

  -- v1 order over the whole result: final_priority CRITICAL → LOW → null, then created_at ascending
  select count(*) into bad from (
    select n, rank, created_at,
           lag(rank) over (order by n) as prev_rank, lag(created_at) over (order by n) as prev_created
    from (
      select n, case x ->> 'final_priority' when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'LOW' then 3 else 4 end as rank,
             (x ->> 'created_at')::timestamptz as created_at
      from jsonb_array_elements(res) with ordinality as t(x, n)
    ) r
  ) o
  where prev_rank > rank or (prev_rank = rank and prev_created > created_at);
  perform pg_temp.assert_eq('global v1 ordering', bad, 0);

  -- Row shape --------------------------------------------------------------------------------------
  select count(*) into bad from jsonb_array_elements(res) x
  where (select array_agg(k order by k collate "C") from jsonb_object_keys(x) k) is distinct from
        (select array_agg(k order by k collate "C") from unnest(array[
          'id', 'category', 'status', 'final_priority', 'effective_severity', 'severity_source', 'factors', 'score',
          'label', 'distinct_reporter_count', 'recurrence_count', 'report_count', 'department', 'sla_due_at',
          'created_at', 'updated_at', 'is_seed', 'lat', 'lng']) k);
  perform pg_temp.assert_eq('every row has exactly the contract keys', bad, 0);
  select count(*) into bad from jsonb_array_elements(res) x
  where x -> 'factors' <> 'null' or x -> 'score' <> 'null' or x -> 'label' <> 'null' or x -> 'recurrence_count' <> 'null';
  perform pg_temp.assert_eq('v1: factors / score / label / recurrence_count are null', bad, 0);

  -- No reporter ids anywhere (06 rule 22)
  perform pg_temp.assert_eq('no reporter ids in output',
    res::text ~ '00000000-0000-4000-8000-00000000085[123]' or res::text ~ '5eedc000-', false);
  perform pg_temp.assert_eq('no reporter keys', res::text ~ 'reporter_user_id|reporter_ip_hash|actor_user_id', false);

  -- Q1: CITIZEN severity, counts, no department
  e := pg_temp.elem(res, 1);
  perform pg_temp.assert_eq('Q1 row', e - 'created_at' - 'updated_at' - 'lat' - 'lng', jsonb_build_object(
    'id', '10000000-0000-4000-8000-000000000851', 'category', 'POTHOLE', 'status', 'REPORTED', 'final_priority', null,
    'effective_severity', 'HIGH', 'severity_source', 'CITIZEN', 'factors', null, 'score', null, 'label', null,
    'distinct_reporter_count', 2, 'recurrence_count', null, 'report_count', 3, 'department', null, 'sla_due_at', null,
    'is_seed', false));
  perform pg_temp.assert_eq('Q1 created_at', (e ->> 'created_at')::timestamptz, now() - interval '5 hours');
  perform pg_temp.assert_eq('Q1 updated_at', (e ->> 'updated_at')::timestamptz, now());
  perform pg_temp.assert_eq('Q1 lat', round((e ->> 'lat')::numeric, 6), 19.051);
  perform pg_temp.assert_eq('Q1 lng', round((e ->> 'lng')::numeric, 6), 72.851);

  -- Q2: AUTHORITY severity wins over citizen; department; sla; is_seed
  e := pg_temp.elem(res, 2);
  perform pg_temp.assert_eq('Q2 severity', e ->> 'effective_severity', 'LOW');
  perform pg_temp.assert_eq('Q2 source', e ->> 'severity_source', 'AUTHORITY');
  perform pg_temp.assert_eq('Q2 department', e -> 'department', '{"id": "d0000000-0000-4000-8000-000000000851", "name": "Test 085 Dept One"}'::jsonb);
  perform pg_temp.assert_eq('Q2 sla_due_at', (e ->> 'sla_due_at')::timestamptz, now() + interval '23 hours 30 minutes');
  perform pg_temp.assert_eq('Q2 counts', (e ->> 'report_count') || '/' || (e ->> 'distinct_reporter_count'), '1/1');
  perform pg_temp.assert_eq('Q2 is_seed', e -> 'is_seed', 'true'::jsonb);

  -- Q3: DEFAULT severity (from p_config), zero counts
  e := pg_temp.elem(res, 3);
  perform pg_temp.assert_eq('Q3 severity', e ->> 'effective_severity', 'MEDIUM');
  perform pg_temp.assert_eq('Q3 source', e ->> 'severity_source', 'DEFAULT');
  perform pg_temp.assert_eq('Q3 counts', (e ->> 'report_count') || '/' || (e ->> 'distinct_reporter_count'), '0/0');
  -- Q6: AUTHORITY without citizen severity
  perform pg_temp.assert_eq('Q6 source', pg_temp.elem(res, 6) ->> 'severity_source', 'AUTHORITY');
  perform pg_temp.assert_eq('Q6 severity', pg_temp.elem(res, 6) ->> 'effective_severity', 'CRITICAL');

  -- default_severity is read from p_config
  res := public.authority_queue(pg_temp.cfg('LOW'), '{}');
  perform pg_temp.assert_eq('config default severity', pg_temp.elem(res, 3) ->> 'effective_severity', 'LOW');
  perform pg_temp.assert_eq('config default source', pg_temp.elem(res, 3) ->> 'severity_source', 'DEFAULT');
  perform pg_temp.assert_eq('citizen severity unaffected by default', pg_temp.elem(res, 1) ->> 'effective_severity', 'HIGH');

  -- queue_statuses is read from p_config
  res := public.authority_queue(jsonb_set(pg_temp.cfg(), '{queue_statuses}', '["IN_PROGRESS"]'), '{}');
  perform pg_temp.assert_eq('config statuses', pg_temp.mine(res), array['Q3']);

  -- Filters ----------------------------------------------------------------------------------------
  res := public.authority_queue(pg_temp.cfg(), '{"statuses": ["RESOLVED", "REJECTED", "MERGED"]}');
  perform pg_temp.assert_eq('statuses filter (closed)', pg_temp.mine(res), array['Q9', 'Q7', 'Q8']);
  select count(*) into bad from jsonb_array_elements(res) x where x ->> 'status' not in ('RESOLVED', 'REJECTED', 'MERGED');
  perform pg_temp.assert_eq('statuses filter: global', bad, 0);

  res := public.authority_queue(pg_temp.cfg(), '{"statuses": ["REPORTED"]}');
  perform pg_temp.assert_eq('statuses filter REPORTED', pg_temp.mine(res), array['Q4', 'Q5', 'Q1', 'Q6']);

  res := public.authority_queue(pg_temp.cfg(), '{"statuses": []}');
  perform pg_temp.assert_eq('empty statuses → empty result', res, '[]'::jsonb);

  res := public.authority_queue(pg_temp.cfg(), '{"categories": ["POTHOLE", "DRAINAGE"]}');
  perform pg_temp.assert_eq('categories filter', pg_temp.mine(res), array['Q3', 'Q1', 'Q6']);
  select count(*) into bad from jsonb_array_elements(res) x
  where x ->> 'category' not in ('POTHOLE', 'DRAINAGE') or x ->> 'status' not in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS');
  perform pg_temp.assert_eq('categories filter: global (and default statuses)', bad, 0);

  res := public.authority_queue(pg_temp.cfg(), '{"department_id": "d0000000-0000-4000-8000-000000000851"}');
  perform pg_temp.assert_eq('department filter: only Q2 at all', res, jsonb_build_array(pg_temp.elem(res, 2)));
  res := public.authority_queue(pg_temp.cfg(), '{"department_id": "d0000000-0000-4000-8000-000000000851", "statuses": ["RESOLVED"]}');
  perform pg_temp.assert_eq('department + statuses', pg_temp.mine(res), array['Q7']);

  res := public.authority_queue(pg_temp.cfg(), '{"unassigned_only": true}');
  perform pg_temp.assert_eq('unassigned_only', pg_temp.mine(res), array['Q4', 'Q5', 'Q1', 'Q6']);
  select count(*) into bad from jsonb_array_elements(res) x where x -> 'department' <> 'null';
  perform pg_temp.assert_eq('unassigned_only: global', bad, 0);

  res := public.authority_queue(pg_temp.cfg(),
    '{"statuses": ["REPORTED", "ASSIGNED"], "categories": ["POTHOLE", "GARBAGE"], "department_id": null, "unassigned_only": true}');
  perform pg_temp.assert_eq('combined filters', pg_temp.mine(res), array['Q1', 'Q6']);

  -- A bad config is a programming error (route → INTERNAL), not a client error
  perform pg_temp.expect_error($q$select public.authority_queue('{"default_severity": "MEDIUM"}', '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue('{"queue_statuses": ["REPORTED"]}', '{}')$q$, '22023');
  perform pg_temp.expect_error($q$select public.authority_queue(null, '{}')$q$, '22023');

  perform pg_temp.assert_eq('volatility stable', (select provolatile from pg_proc where oid = 'public.authority_queue(jsonb, jsonb)'::regprocedure), 's'::"char");
end $$;
reset role;

rollback;

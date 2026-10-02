-- RLS tests (04 §4, 02 §7.3–7.4, 02 §15): citizens (authenticated, anonymous auth users),
-- anon, and an authority user. Runs in one transaction that is rolled back.
begin;

create function pg_temp.expect_error(p_sql text, p_state text, p_msg text default null)
returns void language plpgsql as $$
declare raised boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    raised := true;
    if sqlstate <> p_state or (p_msg is not null and sqlerrm not like p_msg) then
      raise exception 'expected % (%) but got % (%) from: %', p_state, coalesce(p_msg, '*'), sqlstate, sqlerrm, p_sql;
    end if;
  end;
  if not raised then
    raise exception 'expected % but statement succeeded: %', p_state, p_sql;
  end if;
end $$;
grant execute on function pg_temp.expect_error(text, text, text) to public;

-- Rows that exist before this file's fixtures (the seed, when loaded) are ignored by assert_ids,
-- so these assertions only see the fixtures below.
create temp table preexisting_ids as
            select id from public.users
  union all select id from public.departments
  union all select id from public.issues
  union all select id from public.reports
  union all select id from public.issue_events
  union all select id from public.resolution_evidence
  union all select id from public.risk_zones
  union all select id from public.hotspots
  union all select issue_id from public.hotspot_issues;
grant select on preexisting_ids to public;

-- assert_ids(label, query, expected ids): the query's id set (as the current role), minus
-- preexisting_ids, must equal expected.
create function pg_temp.assert_ids(p_label text, p_sql text, p_expected uuid[])
returns void language plpgsql as $$
declare got uuid[];
begin
  execute format('select coalesce(array_agg(id order by id), ''{}'') from (%s) q
                  where id not in (select p.id from pg_temp.preexisting_ids p)', p_sql) into got;
  if got <> (select coalesce(array_agg(x order by x), '{}') from unnest(p_expected) x) then
    raise exception '%: expected % got %', p_label, p_expected, got;
  end if;
end $$;
grant execute on function pg_temp.assert_ids(text, text, uuid[]) to public;

-- Catalog checks ----------------------------------------------------------------------------------
do $$ declare bad text[]; begin
  select array_agg(c.relname) into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if bad is not null then raise exception 'RLS not enabled on: %', bad; end if;

  select array_agg(tablename || '.' || policyname) into bad
  from pg_policies where schemaname = 'public' and cmd <> 'SELECT';
  if bad is not null then raise exception 'unexpected write policies: %', bad; end if;

  select array_agg(table_name || ':' || privilege_type) into bad
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if bad is not null then raise exception 'anon/authenticated still hold write grants: %', bad; end if;

  if not has_table_privilege('authenticated', 'public.issues', 'select') then
    raise exception 'authenticated lost SELECT on issues';
  end if;
end $$;

-- Fixtures (superuser) ----------------------------------------------------------------------------
-- A1 = authority; C1, C2 = citizens; C3 = citizen with no reports.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'authority@test.local');
insert into public.users (id, name, email) values ('00000000-0000-4000-8000-0000000000a1', 'Test Authority', 'authority@test.local');
insert into public.departments (id, name, sla_hours) values ('00000000-0000-4000-8000-0000000000d1', 'Test Roads', 72);

-- I1 REPORTED (C1), I2 REPORTED (C2), I3 REJECTED (C1), I4 REJECTED (C2)
insert into public.issues (id, category, status, geom) values
  ('10000000-0000-4000-8000-000000000001', 'POTHOLE', 'REPORTED', 'SRID=4326;POINT(72.83 19.05)'),
  ('10000000-0000-4000-8000-000000000002', 'GARBAGE', 'REPORTED', 'SRID=4326;POINT(72.84 19.06)'),
  ('10000000-0000-4000-8000-000000000003', 'POTHOLE', 'REJECTED', 'SRID=4326;POINT(72.85 19.07)'),
  ('10000000-0000-4000-8000-000000000004', 'OTHER',   'REJECTED', 'SRID=4326;POINT(72.86 19.08)');
insert into public.reports (id, issue_id, reporter_user_id, category, description, image_path, geom) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'POTHOLE', 'r1', 'c1/1.jpg', 'SRID=4326;POINT(72.83 19.05)'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000c2', 'GARBAGE', 'r2', 'c2/2.jpg', 'SRID=4326;POINT(72.84 19.06)'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c1', 'POTHOLE', 'r3', 'c1/3.jpg', 'SRID=4326;POINT(72.85 19.07)'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000c2', 'OTHER',   'r4', 'c2/4.jpg', 'SRID=4326;POINT(72.86 19.08)'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c2', 'POTHOLE', 'r5', 'c2/5.jpg', 'SRID=4326;POINT(72.83 19.05)');
insert into public.issue_events (id, issue_id, event_type, to_status) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'CREATED', 'REPORTED');
insert into public.resolution_evidence (id, issue_id, uploaded_by, image_path) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a1/e.jpg');
insert into public.risk_zones (id, name, risk_value, geom) values
  ('50000000-0000-4000-8000-000000000001', 'zone', 80, 'SRID=4326;POLYGON((72.8 19.0,72.9 19.0,72.9 19.1,72.8 19.0))');
insert into public.hotspots (id, category, geom, current_issue_count, baseline_issue_count, expected_current_count,
                             trend_percent, severity, explanation, window_start, window_end, active) values
  ('60000000-0000-4000-8000-000000000001', 'POTHOLE', 'SRID=4326;POLYGON((72.8 19.0,72.9 19.0,72.9 19.1,72.8 19.0))',
   4, 0, 0, 300, 'HIGH', 'test', now() - interval '2 hours', now(), true);
insert into public.hotspot_issues (hotspot_id, issue_id) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');

-- Citizen C1 ------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';

select pg_temp.assert_ids('C1 reports (own only)', 'select id from public.reports',
  '{30000000-0000-4000-8000-000000000001,30000000-0000-4000-8000-000000000003}');
select pg_temp.assert_ids('C1 issues (non-rejected + own rejected)', 'select id from public.issues',
  '{10000000-0000-4000-8000-000000000001,10000000-0000-4000-8000-000000000002,10000000-0000-4000-8000-000000000003}');
select pg_temp.assert_ids('C1 issue_events', 'select id from public.issue_events', '{}');
select pg_temp.assert_ids('C1 resolution_evidence', 'select id from public.resolution_evidence', '{}');
select pg_temp.assert_ids('C1 users', 'select id from public.users', '{}');
select pg_temp.assert_ids('C1 departments', 'select id from public.departments', '{00000000-0000-4000-8000-0000000000d1}');
select pg_temp.assert_ids('C1 risk_zones', 'select id from public.risk_zones', '{50000000-0000-4000-8000-000000000001}');
select pg_temp.assert_ids('C1 hotspots', 'select id from public.hotspots', '{60000000-0000-4000-8000-000000000001}');
select pg_temp.assert_ids('C1 hotspot_issues', 'select issue_id as id from public.hotspot_issues', '{10000000-0000-4000-8000-000000000001}');

-- No direct writes to any public table.
do $$ declare t text[]; begin
  foreach t slice 1 in array array[
    ['users', 'name'], ['departments', 'name'], ['issues', 'category'], ['reports', 'description'],
    ['issue_events', 'note'], ['resolution_evidence', 'note'], ['risk_zones', 'name'],
    ['hotspots', 'explanation'], ['hotspot_issues', 'issue_id']
  ] loop
    perform pg_temp.expect_error(format('insert into public.%I default values', t[1]), '42501');
    perform pg_temp.expect_error(format('update public.%I set %I = %I', t[1], t[2], t[2]), '42501');
    perform pg_temp.expect_error(format('delete from public.%I', t[1]), '42501');
    perform pg_temp.expect_error(format('truncate public.%I', t[1]), '42501');
  end loop;
end $$;
-- Status changes only through service_role functions: none are callable here.
select pg_temp.expect_error($q$select public.touch_updated_at()$q$, '42501');
reset role;

-- Even if the write grants came back, RLS (no write policies) still blocks the writes.
grant insert, update, delete on public.issues, public.reports to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select pg_temp.expect_error($q$insert into public.reports (issue_id, reporter_user_id, category, description, image_path, geom) values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'POTHOLE', 'x', 'c1/x.jpg', 'SRID=4326;POINT(72.83 19.05)')$q$,
  '42501', '%row-level security%');
do $$ declare n int; begin
  update public.issues set status = 'REJECTED' where id = '10000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'citizen updated an issue via RLS gap'; end if;
  delete from public.reports where id = '30000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'citizen deleted own report via RLS gap'; end if;
end $$;
reset role;
revoke insert, update, delete on public.issues, public.reports from authenticated;

-- Citizen C2 sees I4 (own rejected) but not I3 --------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}';
select pg_temp.assert_ids('C2 issues', 'select id from public.issues',
  '{10000000-0000-4000-8000-000000000001,10000000-0000-4000-8000-000000000002,10000000-0000-4000-8000-000000000004}');
select pg_temp.assert_ids('C2 reports', 'select id from public.reports',
  '{30000000-0000-4000-8000-000000000002,30000000-0000-4000-8000-000000000004,30000000-0000-4000-8000-000000000005}');
reset role;

-- Random authenticated user with no reports: no rejected issues, no reports -----------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select pg_temp.assert_ids('C3 issues', 'select id from public.issues',
  '{10000000-0000-4000-8000-000000000001,10000000-0000-4000-8000-000000000002}');
select pg_temp.assert_ids('C3 reports', 'select id from public.reports', '{}');
select pg_temp.assert_ids('C3 issue_events', 'select id from public.issue_events', '{}');
reset role;

-- anon (no session) -------------------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select pg_temp.assert_ids('anon issues', 'select id from public.issues',
  '{10000000-0000-4000-8000-000000000001,10000000-0000-4000-8000-000000000002}');
select pg_temp.assert_ids('anon reports', 'select id from public.reports', '{}');
select pg_temp.assert_ids('anon users', 'select id from public.users', '{}');
select pg_temp.assert_ids('anon issue_events', 'select id from public.issue_events', '{}');
select pg_temp.assert_ids('anon departments', 'select id from public.departments', '{00000000-0000-4000-8000-0000000000d1}');
select pg_temp.expect_error($q$insert into public.issues (category, geom) values ('POTHOLE', 'SRID=4326;POINT(72.83 19.05)')$q$, '42501');
reset role;

-- Authority reads everything ------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select pg_temp.assert_ids('authority issues', 'select id from public.issues',
  '{10000000-0000-4000-8000-000000000001,10000000-0000-4000-8000-000000000002,10000000-0000-4000-8000-000000000003,10000000-0000-4000-8000-000000000004}');
select pg_temp.assert_ids('authority reports', 'select id from public.reports',
  '{30000000-0000-4000-8000-000000000001,30000000-0000-4000-8000-000000000002,30000000-0000-4000-8000-000000000003,30000000-0000-4000-8000-000000000004,30000000-0000-4000-8000-000000000005}');
select pg_temp.assert_ids('authority issue_events', 'select id from public.issue_events', '{20000000-0000-4000-8000-000000000001}');
select pg_temp.assert_ids('authority resolution_evidence', 'select id from public.resolution_evidence', '{40000000-0000-4000-8000-000000000001}');
select pg_temp.assert_ids('authority users', 'select id from public.users', '{00000000-0000-4000-8000-0000000000a1}');
-- authority still cannot write directly
select pg_temp.expect_error($q$update public.issues set status = 'REJECTED'$q$, '42501');
select pg_temp.expect_error($q$insert into public.issue_events (issue_id, event_type) values ('10000000-0000-4000-8000-000000000001', 'CREATED')$q$, '42501');
reset role;

rollback;

-- create_report + check_report_rate_limit (20261002000800_create_report.sql).
-- Own fixtures (users 00000000-0000-4000-8000-0000000007xx, ip hashes 'iphash-070-*'); assertions are
-- scoped to them so the seed, when loaded, does not matter. One transaction, rolled back.
-- Note: now() is fixed for the whole transaction, so every report created here has the same created_at.
begin;

-- The assertions below read tables back while still acting as service_role (the role the API uses
-- to call these functions). service_role has no direct table grants (migration 20261002063252), so
-- grant read access for this rolled-back test only; the functions themselves need no grants.
grant select on public.issues, public.reports, public.issue_events, public.resolution_evidence,
  public.departments, public.users to service_role;

create function pg_temp.assert_eq(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception '%: expected % got %', p_label, p_want, p_got; end if;
end $$;
grant execute on function pg_temp.assert_eq(text, anyelement, anyelement) to public;

-- Runs p_sql and requires it to fail with SQLSTATE p_state, message p_message and (if given) detail p_detail.
create function pg_temp.expect_error(p_sql text, p_state text, p_message text default null, p_detail text default null)
returns void language plpgsql as $$
declare raised boolean := false; v_detail text;
begin
  begin
    execute p_sql;
  exception when others then
    raised := true;
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate <> p_state
       or (p_message is not null and sqlerrm is distinct from p_message)
       or (p_detail is not null and v_detail is distinct from p_detail) then
      raise exception 'expected %/%/% but got %/%/% from: %',
        p_state, p_message, p_detail, sqlstate, sqlerrm, v_detail, p_sql;
    end if;
  end;
  if not raised then raise exception 'expected % but statement succeeded: %', p_state, p_sql; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text, text, text) to public;

-- create_report with defaults for the fields a test does not care about.
create function pg_temp.cr(
  p_actor uuid, p_ip text, p_config jsonb,
  p_path text default null, p_description text default 'a report', p_category public.issue_category default 'POTHOLE'
) returns jsonb language sql as $$
  select public.create_report(p_actor, p_ip, p_category, null, p_description,
                              coalesce(p_path, p_actor::text || '/00000000-0000-4000-8000-000000000070.jpg'),
                              19.07, 72.87, p_config)
$$;
grant execute on function pg_temp.cr(uuid, text, jsonb, text, text, public.issue_category) to public;

-- Same as RATE_LIMIT_CONFIG in src/config/civic.ts (02 §9).
create function pg_temp.cfg(p_user int default 5, p_ip int default 100, p_hours numeric default 1)
returns jsonb language sql as $$
  select jsonb_build_object('window_hours', p_hours, 'max_reports_per_user', p_user, 'max_reports_per_ip_hash', p_ip)
$$;
grant execute on function pg_temp.cfg(int, int, numeric) to public;

create function pg_temp.user_reports(p_actor uuid) returns int language sql as $$
  select count(*)::int from public.reports where reporter_user_id = p_actor
$$;
grant execute on function pg_temp.user_reports(uuid) to public;

-- Privileges -------------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'public.create_report(uuid, text, public.issue_category, public.level, text, text, double precision, double precision, jsonb)',
    'public.check_report_rate_limit(uuid, text, jsonb)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is executable by anon/authenticated', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% is not executable by service_role', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception '% is not security definer', f;
    end if;
    if not (select proconfig @> array['search_path=public, extensions'] from pg_proc where oid = f::regprocedure) then
      raise exception '% does not pin search_path = public, extensions', f;
    end if;
  end loop;
end $$;

set local role authenticated;
select pg_temp.expect_error($q$select pg_temp.cr('00000000-0000-4000-8000-000000000701', null, pg_temp.cfg())$q$, '42501');
select pg_temp.expect_error($q$select public.check_report_rate_limit('00000000-0000-4000-8000-000000000701', null, pg_temp.cfg())$q$, '42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select pg_temp.cr('00000000-0000-4000-8000-000000000701', null, pg_temp.cfg())$q$, '42501');
select pg_temp.expect_error($q$select public.check_report_rate_limit('00000000-0000-4000-8000-000000000701', null, pg_temp.cfg())$q$, '42501');
reset role;

-- Fixtures (superuser) ---------------------------------------------------------------------------
-- One photo per user in report-photos; U7 also has one in the wrong bucket.
insert into storage.objects (bucket_id, name)
select 'report-photos', u::text || '/00000000-0000-4000-8000-000000000070.jpg'
from unnest(array[
  '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
  '00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000704',
  '00000000-0000-4000-8000-000000000705', '00000000-0000-4000-8000-000000000706',
  '00000000-0000-4000-8000-000000000707'
]::uuid[]) u;
insert into storage.objects (bucket_id, name) values
  ('resolution-photos', '00000000-0000-4000-8000-000000000707/00000000-0000-4000-8000-000000000071.jpg');

-- An old issue to hang back-dated U1 reports on.
insert into public.issues (id, category, geom, created_at) values
  ('10000000-0000-4000-8000-000000000701', 'GARBAGE', 'SRID=4326;POINT(72.80 19.00)', now() - interval '3 hours');

-- Happy path (called as service_role) ------------------------------------------------------------
set local role service_role;
do $$
declare
  res jsonb; i public.issues%rowtype; r public.reports%rowtype; e public.issue_events%rowtype; n int;
begin
  res := public.create_report('00000000-0000-4000-8000-000000000701', 'iphash-070-u1', 'WATER_LEAK', 'HIGH',
                              E'  Burst pipe near the bus stop \n', '00000000-0000-4000-8000-000000000701/00000000-0000-4000-8000-000000000070.jpg',
                              19.0761, 72.8775, pg_temp.cfg());
  perform pg_temp.assert_eq('result keys', (select array_agg(k order by k) from jsonb_object_keys(res) k), array['issue_id', 'report_id']);

  select * into strict i from public.issues where id = (res ->> 'issue_id')::uuid;
  perform pg_temp.assert_eq('issue status', i.status, 'REPORTED'::public.issue_status);
  perform pg_temp.assert_eq('issue category', i.category, 'WATER_LEAK'::public.issue_category);
  perform pg_temp.assert_eq('issue citizen_severity', i.citizen_severity, 'HIGH'::public.level);
  perform pg_temp.assert_eq('issue is_seed', i.is_seed, false);
  perform pg_temp.assert_eq('issue lat', round(st_y(i.geom::geometry)::numeric, 6), 19.0761);
  perform pg_temp.assert_eq('issue lng', round(st_x(i.geom::geometry)::numeric, 6), 72.8775);
  perform pg_temp.assert_eq('issue srid', st_srid(i.geom::geometry), 4326);
  perform pg_temp.assert_eq('issue authority fields empty',
    row(i.authority_severity, i.final_priority, i.assigned_department_id, i.merged_into_issue_id, i.resolved_at)::text, '(,,,,)');

  select * into strict r from public.reports where id = (res ->> 'report_id')::uuid;
  perform pg_temp.assert_eq('report issue', r.issue_id, i.id);
  perform pg_temp.assert_eq('report reporter', r.reporter_user_id, '00000000-0000-4000-8000-000000000701'::uuid);
  perform pg_temp.assert_eq('report ip hash', r.reporter_ip_hash, 'iphash-070-u1');
  perform pg_temp.assert_eq('report category', r.category, 'WATER_LEAK'::public.issue_category);
  perform pg_temp.assert_eq('report citizen_severity', r.citizen_severity, 'HIGH'::public.level);
  perform pg_temp.assert_eq('report description trimmed', r.description, 'Burst pipe near the bus stop');
  perform pg_temp.assert_eq('report image_path', r.image_path,
    '00000000-0000-4000-8000-000000000701/00000000-0000-4000-8000-000000000070.jpg');
  perform pg_temp.assert_eq('report geom = issue geom', st_equals(r.geom::geometry, i.geom::geometry), true);
  perform pg_temp.assert_eq('issue has one report', (select count(*)::int from public.reports where issue_id = i.id), 1);

  select count(*) into n from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('exactly one event', n, 1);
  select * into strict e from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('event type', e.event_type, 'CREATED');
  perform pg_temp.assert_eq('event actor', e.actor_user_id, '00000000-0000-4000-8000-000000000701'::uuid);
  perform pg_temp.assert_eq('event from', e.from_status, null::public.issue_status);
  perform pg_temp.assert_eq('event to', e.to_status, 'REPORTED'::public.issue_status);

  -- citizen_severity may be null
  res := public.create_report('00000000-0000-4000-8000-000000000702', null, 'OTHER', null, 'no severity',
                              '00000000-0000-4000-8000-000000000702/00000000-0000-4000-8000-000000000070.jpg',
                              19.0, 72.9, pg_temp.cfg());
  perform pg_temp.assert_eq('null severity on issue',
    (select citizen_severity from public.issues where id = (res ->> 'issue_id')::uuid), null::public.level);
  perform pg_temp.assert_eq('null ip hash stored',
    (select reporter_ip_hash from public.reports where id = (res ->> 'report_id')::uuid), null::text);
end $$;
reset role;

-- Per-user limit (5/hour from p_config) ----------------------------------------------------------
-- U1 already has 1 report in the window. Back-dated fixtures: one 30 min old (counts), three 2 h old (don't).
insert into public.reports (issue_id, reporter_user_id, reporter_ip_hash, category, description, image_path, geom, created_at)
select '10000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701', 'iphash-070-u1', 'GARBAGE', 'old',
       '00000000-0000-4000-8000-000000000701/old.jpg', 'SRID=4326;POINT(72.80 19.00)', now() - t
from unnest(array[interval '30 minutes', interval '2 hours', interval '2 hours', interval '2 hours']) t;

set local role service_role;
do $$
declare raised boolean := false; v_detail text;
begin
  -- 3 more → 5 in the window
  for k in 1..3 loop
    perform pg_temp.cr('00000000-0000-4000-8000-000000000701', 'iphash-070-u1', pg_temp.cfg());
  end loop;
  perform pg_temp.assert_eq('U1 reports in window (incl. 30-min fixture)',
    (select count(*)::int from public.reports
     where reporter_user_id = '00000000-0000-4000-8000-000000000701' and created_at > now() - interval '1 hour'), 5);

  -- 6th → RATE_LIMITED
  begin
    perform pg_temp.cr('00000000-0000-4000-8000-000000000701', 'iphash-070-u1', pg_temp.cfg());
  exception when sqlstate 'PT429' then
    raised := true;
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.assert_eq('per-user message', sqlerrm, 'RATE_LIMITED');
    perform pg_temp.assert_eq('per-user detail', v_detail, 'per-user limit');
  end;
  if not raised then raise exception '6th report in the window was not rate limited'; end if;
  perform pg_temp.assert_eq('nothing inserted by the limited call', pg_temp.user_reports('00000000-0000-4000-8000-000000000701'), 8);

  -- the reusable check raises the same error directly
  perform pg_temp.expect_error(
    $q$select public.check_report_rate_limit('00000000-0000-4000-8000-000000000701', null, pg_temp.cfg())$q$,
    'PT429', 'RATE_LIMITED', 'per-user limit');

  -- a different user (same config) is unaffected
  perform pg_temp.cr('00000000-0000-4000-8000-000000000702', 'iphash-070-u2', pg_temp.cfg());
  perform pg_temp.assert_eq('U2 unaffected', pg_temp.user_reports('00000000-0000-4000-8000-000000000702'), 2);
end $$;
reset role;

-- Config-driven ----------------------------------------------------------------------------------
set local role service_role;
do $$
begin
  -- limit 2: 3rd call trips
  perform pg_temp.cr('00000000-0000-4000-8000-000000000706', null, pg_temp.cfg(p_user => 2));
  perform pg_temp.cr('00000000-0000-4000-8000-000000000706', null, pg_temp.cfg(p_user => 2));
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000706', null, pg_temp.cfg(p_user => 2))$q$,
    'PT429', 'RATE_LIMITED', 'per-user limit');
  -- the same user is fine under the default limit of 5
  perform pg_temp.cr('00000000-0000-4000-8000-000000000706', null, pg_temp.cfg());
  perform pg_temp.assert_eq('U6 reports', pg_temp.user_reports('00000000-0000-4000-8000-000000000706'), 3);

  -- window_hours comes from p_config: U2 has 2 recent reports; with limit 2 it is limited in any window.
  -- U1 has 8 rows, 5 within 1 h; within 0.25 h only the 4 created now, so a limit of 5 passes there.
  perform public.check_report_rate_limit('00000000-0000-4000-8000-000000000701', null, pg_temp.cfg(p_hours => 0.25));
  perform pg_temp.expect_error(
    $q$select public.check_report_rate_limit('00000000-0000-4000-8000-000000000701', null, pg_temp.cfg(p_user => 8, p_hours => 3))$q$,
    'PT429', 'RATE_LIMITED', 'per-user limit');
  perform public.check_report_rate_limit('00000000-0000-4000-8000-000000000701', null, pg_temp.cfg(p_user => 9, p_hours => 3));

  -- missing keys are a programming error, not a client error (route maps it to INTERNAL)
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000706', null, '{"window_hours":1,"max_reports_per_user":5}')$q$,
    '22023');
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000706', null, null)$q$, '22023');
end $$;
reset role;

-- Per-IP limit -----------------------------------------------------------------------------------
set local role service_role;
do $$
declare raised boolean := false; v_detail text;
begin
  -- three different users share one IP hash; limit 3
  perform pg_temp.cr('00000000-0000-4000-8000-000000000703', 'iphash-070-shared', pg_temp.cfg(p_ip => 3));
  perform pg_temp.cr('00000000-0000-4000-8000-000000000704', 'iphash-070-shared', pg_temp.cfg(p_ip => 3));
  perform pg_temp.cr('00000000-0000-4000-8000-000000000705', 'iphash-070-shared', pg_temp.cfg(p_ip => 3));

  begin
    perform pg_temp.cr('00000000-0000-4000-8000-000000000703', 'iphash-070-shared', pg_temp.cfg(p_ip => 3));
  exception when sqlstate 'PT429' then
    raised := true;
    get stacked diagnostics v_detail = pg_exception_detail;
    perform pg_temp.assert_eq('per-IP message', sqlerrm, 'RATE_LIMITED');
    perform pg_temp.assert_eq('per-IP detail', v_detail, 'per-IP limit');
  end;
  if not raised then raise exception '4th report from the shared IP hash was not rate limited'; end if;
  perform pg_temp.assert_eq('U3 has 1 report', pg_temp.user_reports('00000000-0000-4000-8000-000000000703'), 1);

  -- a fresh user on the same IP is limited too (the per-user count is 0)
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000702', 'iphash-070-shared', pg_temp.cfg(p_ip => 3))$q$,
    'PT429', 'RATE_LIMITED', 'per-IP limit');
  -- default config (100/IP) lets it through: the number comes from p_config
  perform pg_temp.cr('00000000-0000-4000-8000-000000000703', 'iphash-070-shared', pg_temp.cfg());
  -- null ip hash skips the IP check
  perform pg_temp.cr('00000000-0000-4000-8000-000000000703', null, pg_temp.cfg(p_ip => 3));
  perform public.check_report_rate_limit('00000000-0000-4000-8000-000000000704', null, pg_temp.cfg(p_ip => 0));
  -- a different IP hash is unaffected
  perform pg_temp.cr('00000000-0000-4000-8000-000000000703', 'iphash-070-other', pg_temp.cfg(p_ip => 3));
  perform pg_temp.assert_eq('U3 reports', pg_temp.user_reports('00000000-0000-4000-8000-000000000703'), 4);
end $$;
reset role;

-- Image path, storage and validation -------------------------------------------------------------
set local role service_role;
do $$
declare n_before int := (select count(*) from public.reports);
begin
  -- path in another user's folder
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000707', null, pg_temp.cfg(),
         '00000000-0000-4000-8000-000000000702/00000000-0000-4000-8000-000000000070.jpg')$q$,
    'PT403', 'FORBIDDEN');
  -- uid without the trailing slash is not a folder match
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000707', null, pg_temp.cfg(),
         '00000000-0000-4000-8000-000000000707.jpg')$q$,
    'PT403', 'FORBIDDEN');
  -- own folder, but no such object
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000707', null, pg_temp.cfg(),
         '00000000-0000-4000-8000-000000000707/00000000-0000-4000-8000-0000000000ff.jpg')$q$,
    'PT400', 'VALIDATION_FAILED', 'photo not found in storage');
  -- object exists, but in the wrong bucket
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000707', null, pg_temp.cfg(),
         '00000000-0000-4000-8000-000000000707/00000000-0000-4000-8000-000000000071.jpg')$q$,
    'PT400', 'VALIDATION_FAILED', 'photo not found in storage');
  -- blank / missing description
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000707', null, pg_temp.cfg(), null, E'  \t ')$q$,
    'PT400', 'VALIDATION_FAILED');
  perform pg_temp.expect_error(
    $q$select pg_temp.cr('00000000-0000-4000-8000-000000000707', null, pg_temp.cfg(), null, null)$q$,
    'PT400', 'VALIDATION_FAILED');
  -- bad location, missing category, missing actor
  perform pg_temp.expect_error(
    $q$select public.create_report('00000000-0000-4000-8000-000000000707', null, 'POTHOLE', null, 'x',
         '00000000-0000-4000-8000-000000000707/00000000-0000-4000-8000-000000000070.jpg', 91, 72.8, pg_temp.cfg())$q$,
    'PT400', 'VALIDATION_FAILED');
  perform pg_temp.expect_error(
    $q$select public.create_report('00000000-0000-4000-8000-000000000707', null, null, null, 'x',
         '00000000-0000-4000-8000-000000000707/00000000-0000-4000-8000-000000000070.jpg', 19, 72.8, pg_temp.cfg())$q$,
    'PT400', 'VALIDATION_FAILED');
  perform pg_temp.expect_error(
    $q$select public.create_report(null, null, 'POTHOLE', null, 'x',
         '00000000-0000-4000-8000-000000000707/00000000-0000-4000-8000-000000000070.jpg', 19, 72.8, pg_temp.cfg())$q$,
    'PT403', 'FORBIDDEN');

  perform pg_temp.assert_eq('failed calls inserted nothing', (select count(*)::int from public.reports), n_before);
  -- and U7's valid call still works
  perform pg_temp.cr('00000000-0000-4000-8000-000000000707', null, pg_temp.cfg());
  perform pg_temp.assert_eq('U7 reports', pg_temp.user_reports('00000000-0000-4000-8000-000000000707'), 1);
end $$;
reset role;

-- Every issue created here has exactly one report and one CREATED event --------------------------
do $$ declare bad int; begin
  select count(*) into bad
  from public.issues i
  where exists (select 1 from public.reports r where r.issue_id = i.id
                and r.reporter_user_id::text like '00000000-0000-4000-8000-0000000007%')
    and i.id <> '10000000-0000-4000-8000-000000000701'
    and ((select count(*) from public.reports r where r.issue_id = i.id) <> 1
      or (select count(*) from public.issue_events e where e.issue_id = i.id) <> 1
      or not exists (select 1 from public.issue_events e where e.issue_id = i.id and e.event_type = 'CREATED'));
  perform pg_temp.assert_eq('one report + one CREATED per new issue', bad, 0);
end $$;

rollback;

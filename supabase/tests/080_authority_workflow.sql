-- Authority workflow writes (20261002001000_authority_workflow.sql): status_transition_rules,
-- transition_event, set_priority, assign_issue, transition_issue, resolve_issue (02 §4, §5.1, §8).
-- Own fixtures (users / departments / issues 0…08xx, prefixes below); assertions are scoped to them
-- so the seed, when loaded, does not matter. One transaction, rolled back.
-- Note: now() is fixed for the whole transaction, so assigned_at / resolved_at / updated_at = now().
--
--   authority A     00000000-0000-4000-8000-000000000801  (auth.users + public.users AUTHORITY)
--   citizen C       00000000-0000-4000-8000-000000000802  (auth.users only)
--   departments     d0000000-0000-4000-8000-00000000080{1,2,3}  (sla 10 h, 36 h, inactive)
--   issues          10000000-0000-4000-8000-0000000008NN
begin;

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

-- Runs p_sql inside a subtransaction that is always rolled back; returns 'OK' or '<sqlstate> <message>'.
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'try_sql: rollback' using errcode = 'P0099';
  exception when others then
    if sqlstate = 'P0099' then return 'OK'; end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end $$;
grant execute on function pg_temp.try_sql(text) to public;

create function pg_temp.n_events(p_issue uuid) returns int language sql as $$
  select count(*)::int from public.issue_events where issue_id = p_issue
$$;
grant execute on function pg_temp.n_events(uuid) to public;

-- All events on this file's issues.
create function pg_temp.my_events() returns int language sql as $$
  select count(*)::int from public.issue_events where issue_id::text like '10000000-0000-4000-8000-0000000008%'
$$;
grant execute on function pg_temp.my_events() to public;

create function pg_temp.keys(p jsonb) returns text[] language sql as $$
  select array_agg(k order by k) from jsonb_object_keys(p) k
$$;
grant execute on function pg_temp.keys(jsonb) to public;

-- Privileges -------------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'public.status_transition_rules()',
    'public.transition_event(public.issue_status, public.issue_status)',
    'public.set_priority(uuid, uuid, public.level, public.level)',
    'public.assign_issue(uuid, uuid, uuid)',
    'public.transition_issue(uuid, uuid, public.issue_status, text)',
    'public.resolve_issue(uuid, uuid, text, text)',
    'public.authority_queue(jsonb, jsonb)'
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
select pg_temp.expect_error($q$select * from public.status_transition_rules()$q$, '42501');
select pg_temp.expect_error($q$select public.set_priority('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'HIGH', null)$q$, '42501');
select pg_temp.expect_error($q$select public.assign_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'd0000000-0000-4000-8000-000000000801')$q$, '42501');
select pg_temp.expect_error($q$select public.transition_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'REJECTED', 'x')$q$, '42501');
select pg_temp.expect_error($q$select public.resolve_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'x', null)$q$, '42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.status_transition_rules()$q$, '42501');
select pg_temp.expect_error($q$select public.set_priority('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'HIGH', null)$q$, '42501');
select pg_temp.expect_error($q$select public.assign_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'd0000000-0000-4000-8000-000000000801')$q$, '42501');
select pg_temp.expect_error($q$select public.transition_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'REJECTED', 'x')$q$, '42501');
select pg_temp.expect_error($q$select public.resolve_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'x', null)$q$, '42501');
reset role;

-- status_transition_rules = 02 §4 ----------------------------------------------------------------
do $$
declare v_diff text;
begin
  with want (from_status, to_status, event_type, stretch) as (values
    ('REPORTED', 'ASSIGNED', 'ASSIGNED', false), ('ASSIGNED', 'ASSIGNED', 'REASSIGNED', false),
    ('IN_PROGRESS', 'ASSIGNED', 'REASSIGNED', false), ('ASSIGNED', 'IN_PROGRESS', 'STATUS_CHANGED', false),
    ('IN_PROGRESS', 'RESOLVED', 'RESOLVED', false), ('REPORTED', 'REJECTED', 'REJECTED', false),
    ('ASSIGNED', 'REJECTED', 'REJECTED', false), ('REPORTED', 'MERGED', 'MERGED_INTO', false),
    ('ASSIGNED', 'MERGED', 'MERGED_INTO', false), ('IN_PROGRESS', 'MERGED', 'MERGED_INTO', false),
    ('RESOLVED', 'REOPENED', 'REOPENED', true), ('REOPENED', 'ASSIGNED', 'ASSIGNED', true),
    ('REOPENED', 'IN_PROGRESS', 'STATUS_CHANGED', true), ('REOPENED', 'REJECTED', 'REJECTED', true),
    ('REOPENED', 'MERGED', 'MERGED_INTO', true)
  ), got as (select from_status::text, to_status::text, event_type, stretch from public.status_transition_rules())
  select string_agg(x, '; ') into v_diff from (
    (select 'missing ' || w::text from (select * from want except select * from got) w)
    union all
    (select 'extra ' || g::text from (select * from got except select * from want) g)
  ) d(x);
  if v_diff is not null then raise exception 'status_transition_rules differs from 02 §4: %', v_diff; end if;
  perform pg_temp.assert_eq('no duplicate (from, to)',
    (select count(*)::int from public.status_transition_rules()),
    (select count(distinct (from_status, to_status))::int from public.status_transition_rules()));
  perform pg_temp.assert_eq('volatility', (select provolatile from pg_proc where oid = 'public.status_transition_rules()'::regprocedure), 'i'::"char");
end $$;

-- Fixtures (superuser) ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000801', 'authenticated', 'authenticated', 'authority-080@civicpulse.invalid'),
  ('00000000-0000-4000-8000-000000000802', 'authenticated', 'authenticated', null);
insert into public.users (id, name, email) values
  ('00000000-0000-4000-8000-000000000801', 'Authority 080', 'authority-080@civicpulse.invalid');

insert into public.departments (id, name, sla_hours, active) values
  ('d0000000-0000-4000-8000-000000000801', 'Test 080 Ten Hours',    10, true),
  ('d0000000-0000-4000-8000-000000000802', 'Test 080 Thirty Six',   36, true),
  ('d0000000-0000-4000-8000-000000000803', 'Test 080 Closed Office', 72, false);

-- One issue per scenario. D1 = 0801, D2 = 0802. No CREATED events, so each issue starts with 0 events.
insert into public.issues (id, category, status, assigned_department_id, assigned_at, sla_due_at, resolved_at, geom) values
  -- happy paths
  ('10000000-0000-4000-8000-000000000801', 'POTHOLE', 'REPORTED',    null, null, null, null, 'SRID=4326;POINT(72.80 19.00)'),  -- assign
  ('10000000-0000-4000-8000-000000000802', 'POTHOLE', 'ASSIGNED',    'd0000000-0000-4000-8000-000000000801', now() - interval '2 days', now() - interval '1 day', null, 'SRID=4326;POINT(72.80 19.00)'),  -- reassign
  ('10000000-0000-4000-8000-000000000803', 'POTHOLE', 'IN_PROGRESS', 'd0000000-0000-4000-8000-000000000801', now() - interval '2 days', now() - interval '1 day', null, 'SRID=4326;POINT(72.80 19.00)'),  -- reassign from IN_PROGRESS
  ('10000000-0000-4000-8000-000000000804', 'POTHOLE', 'ASSIGNED',    'd0000000-0000-4000-8000-000000000801', now() - interval '2 days', now() - interval '1 day', null, 'SRID=4326;POINT(72.80 19.00)'),  -- start work
  ('10000000-0000-4000-8000-000000000805', 'POTHOLE', 'IN_PROGRESS', 'd0000000-0000-4000-8000-000000000801', now() - interval '2 days', now() - interval '1 day', null, 'SRID=4326;POINT(72.80 19.00)'),  -- resolve
  ('10000000-0000-4000-8000-000000000806', 'POTHOLE', 'REPORTED',    null, null, null, null, 'SRID=4326;POINT(72.80 19.00)'),  -- reject
  ('10000000-0000-4000-8000-000000000807', 'POTHOLE', 'ASSIGNED',    'd0000000-0000-4000-8000-000000000802', now() - interval '2 days', now() - interval '1 day', null, 'SRID=4326;POINT(72.80 19.00)'),  -- reject
  -- one per status, for disallowed / matrix checks (never changed)
  ('10000000-0000-4000-8000-000000000811', 'GARBAGE', 'REPORTED',    null, null, null, null, 'SRID=4326;POINT(72.81 19.01)'),
  ('10000000-0000-4000-8000-000000000812', 'GARBAGE', 'ASSIGNED',    'd0000000-0000-4000-8000-000000000801', now() - interval '1 day', now(), null, 'SRID=4326;POINT(72.81 19.01)'),
  ('10000000-0000-4000-8000-000000000813', 'GARBAGE', 'IN_PROGRESS', 'd0000000-0000-4000-8000-000000000801', now() - interval '1 day', now(), null, 'SRID=4326;POINT(72.81 19.01)'),
  ('10000000-0000-4000-8000-000000000814', 'GARBAGE', 'RESOLVED',    'd0000000-0000-4000-8000-000000000801', now() - interval '1 day', now(), now() - interval '1 hour', 'SRID=4326;POINT(72.81 19.01)'),
  ('10000000-0000-4000-8000-000000000815', 'GARBAGE', 'REJECTED',    null, null, null, null, 'SRID=4326;POINT(72.81 19.01)'),
  ('10000000-0000-4000-8000-000000000817', 'GARBAGE', 'REOPENED',    'd0000000-0000-4000-8000-000000000801', now() - interval '1 day', now(), now() - interval '1 hour', 'SRID=4326;POINT(72.81 19.01)'),
  -- set_priority
  ('10000000-0000-4000-8000-000000000821', 'WATER_LEAK', 'REPORTED', null, null, null, null, 'SRID=4326;POINT(72.82 19.02)');
insert into public.issues (id, category, status, merged_into_issue_id, geom) values
  ('10000000-0000-4000-8000-000000000816', 'GARBAGE', 'MERGED', '10000000-0000-4000-8000-000000000811', 'SRID=4326;POINT(72.81 19.01)');

-- Back-date updated_at (bypassing the touch trigger) so a stale updated_at in a result is detectable.
set local session_replication_role = replica;
update public.issues set updated_at = now() - interval '1 day' where id::text like '10000000-0000-4000-8000-0000000008%';
set local session_replication_role = origin;

-- Photos: A has one in resolution-photos and one only in report-photos; C has one in resolution-photos.
insert into storage.objects (bucket_id, name) values
  ('resolution-photos', '00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-000000000081.jpg'),
  ('report-photos',     '00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-000000000082.jpg'),
  ('resolution-photos', '00000000-0000-4000-8000-000000000802/00000000-0000-4000-8000-000000000081.jpg');

-- Authorisation and NOT_FOUND --------------------------------------------------------------------
set local role service_role;
do $$
declare n_before int := pg_temp.my_events(); a text; b text;
begin
  -- the citizen, an unknown uuid and null are all FORBIDDEN, before the issue is even looked up
  foreach a in array array['''00000000-0000-4000-8000-000000000802''', '''00000000-0000-4000-8000-0000000008ff''', 'null'] loop
    foreach b in array array['''10000000-0000-4000-8000-000000000801''', '''10000000-0000-4000-8000-0000000008ff'''] loop
      perform pg_temp.expect_error(format('select public.set_priority(%s, %s, ''HIGH'', null)', a, b), 'PT403', 'FORBIDDEN');
      perform pg_temp.expect_error(format('select public.assign_issue(%s, %s, ''d0000000-0000-4000-8000-000000000801'')', a, b), 'PT403', 'FORBIDDEN');
      perform pg_temp.expect_error(format('select public.transition_issue(%s, %s, ''REJECTED'', ''spam'')', a, b), 'PT403', 'FORBIDDEN');
      perform pg_temp.expect_error(format('select public.transition_issue(%s, %s, ''IN_PROGRESS'', null)', a, b), 'PT403', 'FORBIDDEN');
      perform pg_temp.expect_error(format('select public.resolve_issue(%s, %s, ''00000000-0000-4000-8000-000000000802/00000000-0000-4000-8000-000000000081.jpg'', null)', a, b), 'PT403', 'FORBIDDEN');
    end loop;
  end loop;

  -- authority, missing issue
  perform pg_temp.expect_error($q$select public.set_priority('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-0000000008ff', 'HIGH', null)$q$, 'PT404', 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.assign_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-0000000008ff', 'd0000000-0000-4000-8000-000000000801')$q$, 'PT404', 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.transition_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-0000000008ff', 'IN_PROGRESS', null)$q$, 'PT404', 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.resolve_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-0000000008ff', '00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-000000000081.jpg', null)$q$, 'PT404', 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.set_priority('00000000-0000-4000-8000-000000000801', null, 'HIGH', null)$q$, 'PT404', 'NOT_FOUND');

  perform pg_temp.assert_eq('no events written by refused calls', pg_temp.my_events(), n_before);
  perform pg_temp.assert_eq('no evidence written', (select count(*)::int from public.resolution_evidence where issue_id::text like '10000000-0000-4000-8000-0000000008%'), 0);
end $$;
reset role;

-- Every allowed transition: one correct event each -----------------------------------------------
set local role service_role;
do $$
declare res jsonb; i public.issues%rowtype; e public.issue_events%rowtype; ev public.resolution_evidence%rowtype;
begin
  -- REPORTED → ASSIGNED (ASSIGNED); sla_due_at = assigned_at + 10 h (D1's sla_hours, not 72)
  res := public.assign_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'd0000000-0000-4000-8000-000000000801');
  perform pg_temp.assert_eq('assign keys', pg_temp.keys(res),
    array['assigned_at', 'department', 'event_type', 'issue_id', 'sla_due_at', 'status', 'updated_at']);
  select * into strict i from public.issues where id = '10000000-0000-4000-8000-000000000801';
  perform pg_temp.assert_eq('assign status', i.status, 'ASSIGNED'::public.issue_status);
  perform pg_temp.assert_eq('assign department', i.assigned_department_id, 'd0000000-0000-4000-8000-000000000801'::uuid);
  perform pg_temp.assert_eq('assign assigned_at', i.assigned_at, now());
  perform pg_temp.assert_eq('assign sla_due_at = assigned_at + sla_hours', i.sla_due_at, i.assigned_at + interval '10 hours');
  perform pg_temp.assert_eq('assign res issue_id', res ->> 'issue_id', i.id::text);
  perform pg_temp.assert_eq('assign res status', res ->> 'status', 'ASSIGNED');
  perform pg_temp.assert_eq('assign res event_type', res ->> 'event_type', 'ASSIGNED');
  perform pg_temp.assert_eq('assign res department', res -> 'department',
    '{"id": "d0000000-0000-4000-8000-000000000801", "name": "Test 080 Ten Hours"}'::jsonb);
  perform pg_temp.assert_eq('assign res assigned_at', (res ->> 'assigned_at')::timestamptz, i.assigned_at);
  perform pg_temp.assert_eq('assign res sla_due_at', (res ->> 'sla_due_at')::timestamptz, i.sla_due_at);
  perform pg_temp.assert_eq('assign res updated_at', (res ->> 'updated_at')::timestamptz, i.updated_at);
  perform pg_temp.assert_eq('assign updated_at bumped', i.updated_at, now());
  perform pg_temp.assert_eq('assign: one event', pg_temp.n_events(i.id), 1);
  select * into strict e from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('assign event', row(e.event_type, e.from_status, e.to_status, e.actor_user_id, e.note)::text,
    row('ASSIGNED', 'REPORTED'::public.issue_status, 'ASSIGNED'::public.issue_status, '00000000-0000-4000-8000-000000000801'::uuid, null::text)::text);
  perform pg_temp.assert_eq('assign event metadata', e.metadata,
    '{"department_id": "d0000000-0000-4000-8000-000000000801", "previous_department_id": null}'::jsonb);

  -- ASSIGNED → ASSIGNED, different department (REASSIGNED); sla from D2 (36 h)
  res := public.assign_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000802', 'd0000000-0000-4000-8000-000000000802');
  select * into strict i from public.issues where id = '10000000-0000-4000-8000-000000000802';
  perform pg_temp.assert_eq('reassign status', i.status, 'ASSIGNED'::public.issue_status);
  perform pg_temp.assert_eq('reassign department', i.assigned_department_id, 'd0000000-0000-4000-8000-000000000802'::uuid);
  perform pg_temp.assert_eq('reassign assigned_at reset', i.assigned_at, now());
  perform pg_temp.assert_eq('reassign sla_due_at', i.sla_due_at, now() + interval '36 hours');
  perform pg_temp.assert_eq('reassign res event_type', res ->> 'event_type', 'REASSIGNED');
  perform pg_temp.assert_eq('reassign res updated_at', (res ->> 'updated_at')::timestamptz, now());
  perform pg_temp.assert_eq('reassign res department name', res #>> '{department,name}', 'Test 080 Thirty Six');
  perform pg_temp.assert_eq('reassign: one event', pg_temp.n_events(i.id), 1);
  select * into strict e from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('reassign event', row(e.event_type, e.from_status, e.to_status, e.actor_user_id, e.note)::text,
    row('REASSIGNED', 'ASSIGNED'::public.issue_status, 'ASSIGNED'::public.issue_status, '00000000-0000-4000-8000-000000000801'::uuid, null::text)::text);
  perform pg_temp.assert_eq('reassign event metadata', e.metadata,
    '{"department_id": "d0000000-0000-4000-8000-000000000802", "previous_department_id": "d0000000-0000-4000-8000-000000000801"}'::jsonb);

  -- IN_PROGRESS → ASSIGNED, different department (REASSIGNED; status goes back to ASSIGNED)
  res := public.assign_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000803', 'd0000000-0000-4000-8000-000000000802');
  select * into strict i from public.issues where id = '10000000-0000-4000-8000-000000000803';
  perform pg_temp.assert_eq('reassign from IN_PROGRESS status', i.status, 'ASSIGNED'::public.issue_status);
  perform pg_temp.assert_eq('reassign from IN_PROGRESS res status', res ->> 'status', 'ASSIGNED');
  perform pg_temp.assert_eq('reassign from IN_PROGRESS res event_type', res ->> 'event_type', 'REASSIGNED');
  perform pg_temp.assert_eq('reassign from IN_PROGRESS sla', i.sla_due_at, now() + interval '36 hours');
  perform pg_temp.assert_eq('reassign from IN_PROGRESS: one event', pg_temp.n_events(i.id), 1);
  select * into strict e from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('reassign from IN_PROGRESS event', row(e.event_type, e.from_status, e.to_status, e.actor_user_id)::text,
    row('REASSIGNED', 'IN_PROGRESS'::public.issue_status, 'ASSIGNED'::public.issue_status, '00000000-0000-4000-8000-000000000801'::uuid)::text);
  perform pg_temp.assert_eq('reassign from IN_PROGRESS metadata', e.metadata,
    '{"department_id": "d0000000-0000-4000-8000-000000000802", "previous_department_id": "d0000000-0000-4000-8000-000000000801"}'::jsonb);

  -- ASSIGNED → IN_PROGRESS (STATUS_CHANGED); note optional, stored trimmed
  res := public.transition_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000804', 'IN_PROGRESS', E'  crew dispatched \n');
  perform pg_temp.assert_eq('transition keys', pg_temp.keys(res), array['from_status', 'issue_id', 'status', 'updated_at']);
  select * into strict i from public.issues where id = '10000000-0000-4000-8000-000000000804';
  perform pg_temp.assert_eq('start status', i.status, 'IN_PROGRESS'::public.issue_status);
  perform pg_temp.assert_eq('start keeps department', i.assigned_department_id, 'd0000000-0000-4000-8000-000000000801'::uuid);
  perform pg_temp.assert_eq('start keeps sla', i.sla_due_at, now() - interval '1 day');
  perform pg_temp.assert_eq('start res', res - 'updated_at',
    '{"issue_id": "10000000-0000-4000-8000-000000000804", "status": "IN_PROGRESS", "from_status": "ASSIGNED"}'::jsonb);
  perform pg_temp.assert_eq('start res updated_at', (res ->> 'updated_at')::timestamptz, i.updated_at);
  perform pg_temp.assert_eq('start updated_at bumped', i.updated_at, now());
  perform pg_temp.assert_eq('start: one event', pg_temp.n_events(i.id), 1);
  select * into strict e from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('start event', row(e.event_type, e.from_status, e.to_status, e.actor_user_id, e.note, e.metadata)::text,
    row('STATUS_CHANGED', 'ASSIGNED'::public.issue_status, 'IN_PROGRESS'::public.issue_status, '00000000-0000-4000-8000-000000000801'::uuid, 'crew dispatched', '{}'::jsonb)::text);

  -- IN_PROGRESS → RESOLVED (RESOLVED) with an evidence row
  res := public.resolve_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000805',
                              '00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-000000000081.jpg', E'\t Filled and rolled  ');
  perform pg_temp.assert_eq('resolve keys', pg_temp.keys(res), array['evidence', 'issue_id', 'resolved_at', 'status', 'updated_at']);
  perform pg_temp.assert_eq('resolve evidence keys', pg_temp.keys(res -> 'evidence'), array['created_at', 'id', 'note']);
  select * into strict i from public.issues where id = '10000000-0000-4000-8000-000000000805';
  perform pg_temp.assert_eq('resolve status', i.status, 'RESOLVED'::public.issue_status);
  perform pg_temp.assert_eq('resolve resolved_at', i.resolved_at, now());
  perform pg_temp.assert_eq('resolve res status', res ->> 'status', 'RESOLVED');
  perform pg_temp.assert_eq('resolve res resolved_at', (res ->> 'resolved_at')::timestamptz, i.resolved_at);
  perform pg_temp.assert_eq('resolve res updated_at', (res ->> 'updated_at')::timestamptz, i.updated_at);
  perform pg_temp.assert_eq('resolve updated_at bumped', i.updated_at, now());
  select * into strict ev from public.resolution_evidence where issue_id = i.id;
  perform pg_temp.assert_eq('evidence row', row(ev.uploaded_by, ev.image_path, ev.note)::text,
    row('00000000-0000-4000-8000-000000000801'::uuid, '00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-000000000081.jpg', 'Filled and rolled')::text);
  perform pg_temp.assert_eq('resolve res evidence', res -> 'evidence',
    jsonb_build_object('id', ev.id, 'note', 'Filled and rolled', 'created_at', ev.created_at));
  perform pg_temp.assert_eq('resolve res has no image path', res::text like '%.jpg%', false);
  perform pg_temp.assert_eq('resolve: one event', pg_temp.n_events(i.id), 1);
  select * into strict e from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('resolve event', row(e.event_type, e.from_status, e.to_status, e.actor_user_id, e.note)::text,
    row('RESOLVED', 'IN_PROGRESS'::public.issue_status, 'RESOLVED'::public.issue_status, '00000000-0000-4000-8000-000000000801'::uuid, 'Filled and rolled')::text);
  perform pg_temp.assert_eq('resolve event metadata', e.metadata, jsonb_build_object('evidence_id', ev.id));

  -- REPORTED → REJECTED (REJECTED), reason trimmed
  res := public.transition_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000806', 'REJECTED', '  Not a civic issue ');
  select * into strict i from public.issues where id = '10000000-0000-4000-8000-000000000806';
  perform pg_temp.assert_eq('reject REPORTED status', i.status, 'REJECTED'::public.issue_status);
  perform pg_temp.assert_eq('reject REPORTED res', res - 'updated_at',
    '{"issue_id": "10000000-0000-4000-8000-000000000806", "status": "REJECTED", "from_status": "REPORTED"}'::jsonb);
  perform pg_temp.assert_eq('reject REPORTED res updated_at', (res ->> 'updated_at')::timestamptz, i.updated_at);
  perform pg_temp.assert_eq('reject updated_at bumped', i.updated_at, now());
  perform pg_temp.assert_eq('reject REPORTED: one event', pg_temp.n_events(i.id), 1);
  select * into strict e from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('reject REPORTED event', row(e.event_type, e.from_status, e.to_status, e.actor_user_id, e.note, e.metadata)::text,
    row('REJECTED', 'REPORTED'::public.issue_status, 'REJECTED'::public.issue_status, '00000000-0000-4000-8000-000000000801'::uuid, 'Not a civic issue', '{}'::jsonb)::text);

  -- ASSIGNED → REJECTED (REJECTED)
  res := public.transition_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000807', 'REJECTED', 'Duplicate of a private complaint');
  select * into strict i from public.issues where id = '10000000-0000-4000-8000-000000000807';
  perform pg_temp.assert_eq('reject ASSIGNED status', i.status, 'REJECTED'::public.issue_status);
  perform pg_temp.assert_eq('reject ASSIGNED res from_status', res ->> 'from_status', 'ASSIGNED');
  perform pg_temp.assert_eq('reject ASSIGNED: one event', pg_temp.n_events(i.id), 1);
  select * into strict e from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('reject ASSIGNED event', row(e.event_type, e.from_status, e.to_status, e.actor_user_id, e.note)::text,
    row('REJECTED', 'ASSIGNED'::public.issue_status, 'REJECTED'::public.issue_status, '00000000-0000-4000-8000-000000000801'::uuid, 'Duplicate of a private complaint')::text);

  -- the main path continues: 0801 (now ASSIGNED) → IN_PROGRESS → RESOLVED
  perform public.transition_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801', 'IN_PROGRESS', null);
  perform pg_temp.assert_eq('null note stored as null',
    (select note from public.issue_events where issue_id = '10000000-0000-4000-8000-000000000801' and event_type = 'STATUS_CHANGED'), null::text);
  res := public.resolve_issue('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000801',
                              '00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-000000000081.jpg', '   ');
  perform pg_temp.assert_eq('blank evidence note → null', res #> '{evidence,note}', 'null'::jsonb);
  perform pg_temp.assert_eq('main path events',
    (select array_agg(event_type order by event_type) from public.issue_events where issue_id = '10000000-0000-4000-8000-000000000801'),
    array['ASSIGNED', 'RESOLVED', 'STATUS_CHANGED']);
end $$;
reset role;

-- Disallowed transitions, conflicts and validation: nothing written ------------------------------
set local role service_role;
do $$
declare
  n_before  int := pg_temp.my_events();
  ev_before int := (select count(*) from public.resolution_evidence);
  snapshot  text := (select string_agg(i::text, ',' order by id) from public.issues i where id::text like '10000000-0000-4000-8000-00000000081%');
  a constant text := '''00000000-0000-4000-8000-000000000801''';
  photo constant text := '''00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-000000000081.jpg''';
begin
  -- REPORTED → IN_PROGRESS
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000811'', ''IN_PROGRESS'', null)', a),
    'PT409', 'INVALID_TRANSITION', 'REPORTED -> IN_PROGRESS not allowed');
  -- REPORTED → RESOLVED (resolve on REPORTED, valid photo)
  perform pg_temp.expect_error(format('select public.resolve_issue(%s, ''10000000-0000-4000-8000-000000000811'', %s, ''done'')', a, photo),
    'PT409', 'INVALID_TRANSITION', 'REPORTED -> RESOLVED not allowed');
  -- ASSIGNED → RESOLVED (must start work first)
  perform pg_temp.expect_error(format('select public.resolve_issue(%s, ''10000000-0000-4000-8000-000000000812'', %s, null)', a, photo),
    'PT409', 'INVALID_TRANSITION', 'ASSIGNED -> RESOLVED not allowed');
  -- IN_PROGRESS → REJECTED
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000813'', ''REJECTED'', ''spam'')', a),
    'PT409', 'INVALID_TRANSITION', 'IN_PROGRESS -> REJECTED not allowed');
  -- IN_PROGRESS → IN_PROGRESS
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000813'', ''IN_PROGRESS'', null)', a),
    'PT409', 'INVALID_TRANSITION', 'IN_PROGRESS -> IN_PROGRESS not allowed');
  -- RESOLVED → anything
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000814'', ''IN_PROGRESS'', null)', a),
    'PT409', 'INVALID_TRANSITION', 'RESOLVED -> IN_PROGRESS not allowed');
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000814'', ''REJECTED'', ''x'')', a),
    'PT409', 'INVALID_TRANSITION', 'RESOLVED -> REJECTED not allowed');
  perform pg_temp.expect_error(format('select public.assign_issue(%s, ''10000000-0000-4000-8000-000000000814'', ''d0000000-0000-4000-8000-000000000802'')', a),
    'PT409', 'INVALID_TRANSITION', 'RESOLVED -> ASSIGNED not allowed');
  perform pg_temp.expect_error(format('select public.resolve_issue(%s, ''10000000-0000-4000-8000-000000000814'', %s, null)', a, photo),
    'PT409', 'INVALID_TRANSITION', 'RESOLVED -> RESOLVED not allowed');
  -- REOPENED target (stretch, not enabled)
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000814'', ''REOPENED'', ''still broken'')', a),
    'PT409', 'INVALID_TRANSITION', 'RESOLVED -> REOPENED not allowed here: reopen is a stretch feature and not enabled');
  -- stretch rows are not enforced: REOPENED → anything fails while reopen is off
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000817'', ''IN_PROGRESS'', null)', a),
    'PT409', 'INVALID_TRANSITION', 'REOPENED -> IN_PROGRESS not allowed');
  perform pg_temp.expect_error(format('select public.assign_issue(%s, ''10000000-0000-4000-8000-000000000817'', ''d0000000-0000-4000-8000-000000000802'')', a),
    'PT409', 'INVALID_TRANSITION', 'REOPENED -> ASSIGNED not allowed');
  -- REJECTED / MERGED are terminal
  perform pg_temp.expect_error(format('select public.assign_issue(%s, ''10000000-0000-4000-8000-000000000815'', ''d0000000-0000-4000-8000-000000000801'')', a),
    'PT409', 'INVALID_TRANSITION', 'REJECTED -> ASSIGNED not allowed');
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000816'', ''REJECTED'', ''x'')', a),
    'PT409', 'INVALID_TRANSITION', 'MERGED -> REJECTED not allowed');
  -- targets owned by other functions
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000811'', ''ASSIGNED'', null)', a),
    'PT409', 'INVALID_TRANSITION', 'REPORTED -> ASSIGNED not allowed here: use assign_issue');
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000813'', ''RESOLVED'', null)', a),
    'PT409', 'INVALID_TRANSITION', 'IN_PROGRESS -> RESOLVED not allowed here: use resolve_issue');
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000811'', ''MERGED'', null)', a),
    'PT409', 'INVALID_TRANSITION', 'REPORTED -> MERGED not allowed here: use merge_issue');
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000812'', ''REPORTED'', null)', a),
    'PT409', 'INVALID_TRANSITION');

  -- same-department reassign → CONFLICT (from ASSIGNED and from IN_PROGRESS)
  perform pg_temp.expect_error(format('select public.assign_issue(%s, ''10000000-0000-4000-8000-000000000812'', ''d0000000-0000-4000-8000-000000000801'')', a),
    'PT409', 'CONFLICT', 'already assigned to this department');
  perform pg_temp.expect_error(format('select public.assign_issue(%s, ''10000000-0000-4000-8000-000000000813'', ''d0000000-0000-4000-8000-000000000801'')', a),
    'PT409', 'CONFLICT', 'already assigned to this department');

  -- department inactive / unknown / null → VALIDATION_FAILED
  perform pg_temp.expect_error(format('select public.assign_issue(%s, ''10000000-0000-4000-8000-000000000811'', ''d0000000-0000-4000-8000-000000000803'')', a),
    'PT400', 'VALIDATION_FAILED', 'department not found or inactive');
  perform pg_temp.expect_error(format('select public.assign_issue(%s, ''10000000-0000-4000-8000-000000000811'', ''d0000000-0000-4000-8000-0000000008ff'')', a),
    'PT400', 'VALIDATION_FAILED', 'department not found or inactive');
  perform pg_temp.expect_error(format('select public.assign_issue(%s, ''10000000-0000-4000-8000-000000000811'', null)', a),
    'PT400', 'VALIDATION_FAILED');

  -- reject without a reason (null, empty, whitespace) → VALIDATION_FAILED
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000811'', ''REJECTED'', null)', a),
    'PT400', 'VALIDATION_FAILED', 'a reason is required to reject');
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000812'', ''REJECTED'', '''')', a),
    'PT400', 'VALIDATION_FAILED');
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000811'', ''REJECTED'', E'' \t\n '')', a),
    'PT400', 'VALIDATION_FAILED');
  perform pg_temp.expect_error(format('select public.transition_issue(%s, ''10000000-0000-4000-8000-000000000811'', null, ''x'')', a),
    'PT400', 'VALIDATION_FAILED');

  -- resolve_issue photo checks (issue 0813 is IN_PROGRESS)
  perform pg_temp.expect_error(format('select public.resolve_issue(%s, ''10000000-0000-4000-8000-000000000813'', ''00000000-0000-4000-8000-000000000802/00000000-0000-4000-8000-000000000081.jpg'', null)', a),
    'PT403', 'FORBIDDEN');
  perform pg_temp.expect_error(format('select public.resolve_issue(%s, ''10000000-0000-4000-8000-000000000813'', ''00000000-0000-4000-8000-000000000801.jpg'', null)', a),
    'PT403', 'FORBIDDEN');
  perform pg_temp.expect_error(format('select public.resolve_issue(%s, ''10000000-0000-4000-8000-000000000813'', ''00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-0000000000ff.jpg'', null)', a),
    'PT400', 'VALIDATION_FAILED', 'photo not found in storage');
  perform pg_temp.expect_error(format('select public.resolve_issue(%s, ''10000000-0000-4000-8000-000000000813'', ''00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-000000000082.jpg'', null)', a),
    'PT400', 'VALIDATION_FAILED', 'photo not found in storage');
  perform pg_temp.expect_error(format('select public.resolve_issue(%s, ''10000000-0000-4000-8000-000000000813'', null, null)', a),
    'PT400', 'VALIDATION_FAILED');

  perform pg_temp.assert_eq('failed calls wrote no events', pg_temp.my_events(), n_before);
  perform pg_temp.assert_eq('failed calls wrote no evidence', (select count(*)::int from public.resolution_evidence), ev_before);
  perform pg_temp.assert_eq('failed calls changed no issue',
    (select string_agg(i::text, ',' order by id) from public.issues i where id::text like '10000000-0000-4000-8000-00000000081%'), snapshot);
end $$;
reset role;

-- Matrix: every (status × write) outcome follows the enabled rows of status_transition_rules() -----
-- Each call runs in a rolled-back subtransaction, so the 081x fixtures never change. Notes and the
-- photo are valid and the department differs from the current one, so only the status rule decides.
set local role service_role;
do $$
declare
  st public.issue_status; v_id uuid; v_target public.issue_status; v_sql text; v_got text; v_allowed boolean;
  a constant text := '''00000000-0000-4000-8000-000000000801''';
  n_checked int := 0;
begin
  for st, v_id in
    select status, id from public.issues where id::text like '10000000-0000-4000-8000-00000000081%'
  loop
    foreach v_target in array array['ASSIGNED', 'IN_PROGRESS', 'REJECTED', 'RESOLVED']::public.issue_status[] loop
      v_sql := case v_target
        when 'ASSIGNED' then format('select public.assign_issue(%s, %L, ''d0000000-0000-4000-8000-000000000802'')', a, v_id)
        when 'RESOLVED' then format('select public.resolve_issue(%s, %L, ''00000000-0000-4000-8000-000000000801/00000000-0000-4000-8000-000000000081.jpg'', ''ok'')', a, v_id)
        else format('select public.transition_issue(%s, %L, %L, ''a reason'')', a, v_id, v_target)
      end;
      v_allowed := exists (select 1 from public.status_transition_rules() r
                           where r.from_status = st and r.to_status = v_target and not r.stretch);
      v_got := pg_temp.try_sql(v_sql);
      if v_allowed and v_got <> 'OK' then
        raise exception 'matrix: % -> % should succeed, got %', st, v_target, v_got;
      elsif not v_allowed and v_got <> 'PT409 INVALID_TRANSITION' then
        raise exception 'matrix: % -> % should be INVALID_TRANSITION, got %', st, v_target, v_got;
      end if;
      n_checked := n_checked + 1;
    end loop;
  end loop;
  perform pg_temp.assert_eq('matrix size (7 statuses x 4 targets)', n_checked, 28);
  perform pg_temp.assert_eq('matrix left no events', (select count(*)::int from public.issue_events where issue_id::text like '10000000-0000-4000-8000-00000000081%'), 0);
end $$;
reset role;

-- set_priority -----------------------------------------------------------------------------------
set local role service_role;
do $$
declare res jsonb; i public.issues%rowtype; e public.issue_events%rowtype;
  v_issue constant uuid := '10000000-0000-4000-8000-000000000821';
  a constant uuid := '00000000-0000-4000-8000-000000000801';
begin
  -- final_priority only
  res := public.set_priority(a, v_issue, 'HIGH', null);
  perform pg_temp.assert_eq('priority keys', pg_temp.keys(res),
    array['authority_severity', 'final_priority', 'issue_id', 'status', 'updated_at']);
  perform pg_temp.assert_eq('priority res', res - 'updated_at',
    jsonb_build_object('issue_id', v_issue, 'status', 'REPORTED', 'final_priority', 'HIGH', 'authority_severity', null));
  select * into strict i from public.issues where id = v_issue;
  perform pg_temp.assert_eq('priority stored', row(i.final_priority, i.authority_severity, i.status)::text,
    row('HIGH'::public.level, null::public.level, 'REPORTED'::public.issue_status)::text);
  perform pg_temp.assert_eq('priority res updated_at', (res ->> 'updated_at')::timestamptz, i.updated_at);
  perform pg_temp.assert_eq('priority updated_at bumped', i.updated_at, now());
  perform pg_temp.assert_eq('priority: one event', pg_temp.n_events(v_issue), 1);
  select * into strict e from public.issue_events where issue_id = v_issue;
  perform pg_temp.assert_eq('PRIORITY_SET event', row(e.event_type, e.from_status, e.to_status, e.actor_user_id, e.note)::text,
    row('PRIORITY_SET', null::public.issue_status, null::public.issue_status, a, null::text)::text);
  perform pg_temp.assert_eq('PRIORITY_SET metadata', e.metadata, '{"from": null, "to": "HIGH"}'::jsonb);

  -- authority_severity only
  res := public.set_priority(a, v_issue, null, 'LOW');
  perform pg_temp.assert_eq('severity res', res - 'updated_at',
    jsonb_build_object('issue_id', v_issue, 'status', 'REPORTED', 'final_priority', 'HIGH', 'authority_severity', 'LOW'));
  perform pg_temp.assert_eq('severity: two events', pg_temp.n_events(v_issue), 2);
  select * into strict e from public.issue_events where issue_id = v_issue and event_type = 'SEVERITY_CONFIRMED';
  perform pg_temp.assert_eq('SEVERITY_CONFIRMED metadata', e.metadata, '{"from": null, "to": "LOW"}'::jsonb);
  perform pg_temp.assert_eq('SEVERITY_CONFIRMED actor', e.actor_user_id, a);

  -- both, both changing → two events with from/to
  res := public.set_priority(a, v_issue, 'CRITICAL', 'HIGH');
  perform pg_temp.assert_eq('both res', res - 'updated_at',
    jsonb_build_object('issue_id', v_issue, 'status', 'REPORTED', 'final_priority', 'CRITICAL', 'authority_severity', 'HIGH'));
  perform pg_temp.assert_eq('both: four events', pg_temp.n_events(v_issue), 4);
  perform pg_temp.assert_eq('both: PRIORITY_SET from/to',
    (select count(*)::int from public.issue_events where issue_id = v_issue and event_type = 'PRIORITY_SET'
       and metadata = '{"from": "HIGH", "to": "CRITICAL"}'), 1);
  perform pg_temp.assert_eq('both: SEVERITY_CONFIRMED from/to',
    (select count(*)::int from public.issue_events where issue_id = v_issue and event_type = 'SEVERITY_CONFIRMED'
       and metadata = '{"from": "LOW", "to": "HIGH"}'), 1);

  -- unchanged → no event (idempotent); one of two changed → one event
  res := public.set_priority(a, v_issue, 'CRITICAL', 'HIGH');
  perform pg_temp.assert_eq('repeat res', res ->> 'final_priority', 'CRITICAL');
  perform pg_temp.assert_eq('repeat: no event', pg_temp.n_events(v_issue), 4);
  perform public.set_priority(a, v_issue, 'CRITICAL', null);
  perform public.set_priority(a, v_issue, null, 'HIGH');
  perform pg_temp.assert_eq('repeat single: no event', pg_temp.n_events(v_issue), 4);
  perform public.set_priority(a, v_issue, 'CRITICAL', 'MEDIUM');
  perform pg_temp.assert_eq('one changed: one event', pg_temp.n_events(v_issue), 5);
  perform pg_temp.assert_eq('one changed: the severity one',
    (select count(*)::int from public.issue_events where issue_id = v_issue and event_type = 'SEVERITY_CONFIRMED'), 3);
  perform pg_temp.assert_eq('status untouched', (select status from public.issues where id = v_issue), 'REPORTED'::public.issue_status);

  -- open statuses ASSIGNED / IN_PROGRESS are fine (in a rolled-back subtransaction)
  perform pg_temp.assert_eq('ASSIGNED ok', pg_temp.try_sql($q$select public.set_priority('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000812', 'LOW', null)$q$), 'OK');
  perform pg_temp.assert_eq('IN_PROGRESS ok', pg_temp.try_sql($q$select public.set_priority('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000813', null, 'LOW')$q$), 'OK');

  -- both null → VALIDATION_FAILED; closed issues → CONFLICT
  perform pg_temp.expect_error($q$select public.set_priority('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000821', null, null)$q$,
    'PT400', 'VALIDATION_FAILED');
  perform pg_temp.expect_error($q$select public.set_priority('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000814', 'HIGH', null)$q$,
    'PT409', 'CONFLICT', 'issue is closed');
  perform pg_temp.expect_error($q$select public.set_priority('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000815', null, 'HIGH')$q$,
    'PT409', 'CONFLICT', 'issue is closed');
  perform pg_temp.expect_error($q$select public.set_priority('00000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-000000000816', 'HIGH', 'HIGH')$q$,
    'PT409', 'CONFLICT', 'issue is closed');
  perform pg_temp.assert_eq('refused calls wrote nothing', pg_temp.n_events(v_issue), 5);
  perform pg_temp.assert_eq('closed issues have no events',
    (select count(*)::int from public.issue_events where issue_id::text like '10000000-0000-4000-8000-00000000081%'), 0);
end $$;
reset role;

rollback;

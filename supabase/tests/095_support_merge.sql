-- add_supporting_report + merge_issue (20261002001100_duplicates_merge.sql; 02 §3.6–3.7, §4, §9, §10.2).
-- Own fixtures around lat 18.97–18.99, lng 72.95 (far from the seed); assertions are scoped to them.
-- One transaction, rolled back. now() is fixed for the whole transaction.
--
--   authority A        00000000-0000-4000-8000-000000009501
--   citizens C1..C4    00000000-0000-4000-8000-00000000951{1,2,3,4}  (no public.users row)
--   department         d0000000-0000-4000-8000-000000009501
--   issues             10000000-0000-4000-8000-0000000095NN
--   reports            20000000-0000-4000-8000-0000000095NN
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

create function pg_temp.keys(p jsonb) returns text[] language sql as $$
  select array_agg(k order by k) from jsonb_object_keys(p) k
$$;
grant execute on function pg_temp.keys(jsonb) to public;

create function pg_temp.iid(p_nn text) returns uuid language sql as $$
  select ('10000000-0000-4000-8000-0000000095' || p_nn)::uuid
$$;
grant execute on function pg_temp.iid(text) to public;

-- RATE_LIMIT_CONFIG + DUPLICATE_CONFIG.compatible_families, as the support route passes it.
create function pg_temp.scfg(p_user int default 5, p_ip int default 100,
                             p_families jsonb default '[["DRAINAGE", "WATERLOGGING", "WATER_LEAK"]]')
returns jsonb language sql as $$
  select jsonb_build_object('window_hours', 1, 'max_reports_per_user', p_user, 'max_reports_per_ip_hash', p_ip,
                            'compatible_families', p_families)
$$;
grant execute on function pg_temp.scfg(int, int, jsonb) to public;

-- add_supporting_report with defaults for the fields a test does not care about.
create function pg_temp.sup(
  p_actor uuid, p_issue uuid, p_category public.issue_category, p_config jsonb default null,
  p_ip text default null, p_path text default null, p_description text default 'same here'
) returns jsonb language sql as $$
  select public.add_supporting_report(p_actor, p_ip, p_issue, p_category, null, p_description,
                                      coalesce(p_path, p_actor::text || '/00000000-0000-4000-8000-000000000095.jpg'),
                                      18.9701, 72.9501, coalesce(p_config, pg_temp.scfg()))
$$;
grant execute on function pg_temp.sup(uuid, uuid, public.issue_category, jsonb, text, text, text) to public;

-- Everything a failed call could have changed, for this file's rows.
create function pg_temp.snapshot() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(row(i.*)::text, ',' order by i.id) from public.issues i where i.id::text like '10000000-0000-4000-8000-0000000095%'),
    (select string_agg(row(r.*)::text, ',' order by r.id) from public.reports r
      where r.issue_id::text like '10000000-0000-4000-8000-0000000095%'
         or r.reporter_user_id::text like '00000000-0000-4000-8000-00000000951%'),
    (select count(*)::text from public.issue_events e where e.issue_id::text like '10000000-0000-4000-8000-0000000095%')))
$$;
grant execute on function pg_temp.snapshot() to public;

-- Privileges -------------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'public.add_supporting_report(uuid, text, uuid, public.issue_category, public.level, text, text, double precision, double precision, jsonb)',
    'public.merge_issue(uuid, uuid, uuid, text)',
    'public.check_report_input(uuid, public.issue_category, text, text, double precision, double precision)',
    'public.create_report(uuid, text, public.issue_category, public.level, text, text, double precision, double precision, jsonb)'
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
select pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'POTHOLE')$q$, '42501');
select pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('21'), pg_temp.iid('22'), null)$q$, '42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'POTHOLE')$q$, '42501');
select pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('21'), pg_temp.iid('22'), null)$q$, '42501');
reset role;

-- Fixtures (superuser) ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000009501', 'authenticated', 'authenticated', 'authority-095@civicpulse.invalid'),
  ('00000000-0000-4000-8000-000000009511', 'authenticated', 'authenticated', null),
  ('00000000-0000-4000-8000-000000009512', 'authenticated', 'authenticated', null),
  ('00000000-0000-4000-8000-000000009513', 'authenticated', 'authenticated', null),
  ('00000000-0000-4000-8000-000000009514', 'authenticated', 'authenticated', null);
insert into public.users (id, name, email) values
  ('00000000-0000-4000-8000-000000009501', 'Authority 095', 'authority-095@civicpulse.invalid');
insert into public.departments (id, name, sla_hours) values
  ('d0000000-0000-4000-8000-000000009501', 'Test 095 Dept', 72);

-- One report photo per citizen; C1 also has one only in resolution-photos.
insert into storage.objects (bucket_id, name)
select 'report-photos', u::text || '/00000000-0000-4000-8000-000000000095.jpg'
from unnest(array['00000000-0000-4000-8000-000000009511', '00000000-0000-4000-8000-000000009512',
                  '00000000-0000-4000-8000-000000009513', '00000000-0000-4000-8000-000000009514']::uuid[]) u;
insert into storage.objects (bucket_id, name) values
  ('resolution-photos', '00000000-0000-4000-8000-000000009511/00000000-0000-4000-8000-000000000096.jpg');

-- support fixtures (01–10)
insert into public.issues (id, category, status, citizen_severity, authority_severity, final_priority, assigned_department_id, resolved_at, geom, created_at) values
  ('10000000-0000-4000-8000-000000009501', 'POTHOLE',  'REPORTED',    'MEDIUM', 'LOW', 'HIGH', null, null, 'SRID=4326;POINT(72.95 18.97)', now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000009502', 'DRAINAGE', 'ASSIGNED',    null, null, null, 'd0000000-0000-4000-8000-000000009501', null, 'SRID=4326;POINT(72.95 18.971)', now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000009503', 'GARBAGE',  'RESOLVED',    null, null, null, 'd0000000-0000-4000-8000-000000009501', now(), 'SRID=4326;POINT(72.95 18.972)', now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000009504', 'GARBAGE',  'REJECTED',    null, null, null, null, null, 'SRID=4326;POINT(72.95 18.972)', now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000009505', 'GARBAGE',  'REOPENED',    null, null, null, 'd0000000-0000-4000-8000-000000009501', now(), 'SRID=4326;POINT(72.95 18.972)', now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000009506', 'GARBAGE',  'REPORTED',    null, null, null, null, null, 'SRID=4326;POINT(72.95 18.973)', now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000009508', 'GARBAGE',  'RESOLVED',    null, null, null, 'd0000000-0000-4000-8000-000000009501', now(), 'SRID=4326;POINT(72.95 18.974)', now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000009510', 'POTHOLE',  'IN_PROGRESS', null, null, null, 'd0000000-0000-4000-8000-000000009501', null, 'SRID=4326;POINT(72.95 18.975)', now() - interval '2 hours');
insert into public.issues (id, category, status, merged_into_issue_id, geom, created_at) values
  ('10000000-0000-4000-8000-000000009507', 'GARBAGE', 'MERGED', '10000000-0000-4000-8000-000000009506', 'SRID=4326;POINT(72.95 18.973)', now() - interval '3 hours'),
  ('10000000-0000-4000-8000-000000009509', 'GARBAGE', 'MERGED', '10000000-0000-4000-8000-000000009508', 'SRID=4326;POINT(72.95 18.974)', now() - interval '3 hours');
insert into public.reports (id, issue_id, reporter_user_id, reporter_ip_hash, category, description, image_path, geom, created_at) values
  ('20000000-0000-4000-8000-000000009501', '10000000-0000-4000-8000-000000009501', '00000000-0000-4000-8000-000000009511', 'iphash-095-c1',
   'POTHOLE', 'first', '00000000-0000-4000-8000-000000009511/00000000-0000-4000-8000-000000000095.jpg', 'SRID=4326;POINT(72.95 18.97)', now() - interval '2 hours');

-- merge fixtures (20–46)
insert into public.issues (id, category, status, citizen_severity, authority_severity, final_priority, assigned_department_id, resolved_at, geom, created_at) values
  ('10000000-0000-4000-8000-000000009521', 'GARBAGE', 'REPORTED',    'LOW',  null,       null,       null, null, 'SRID=4326;POINT(72.951 18.98)', now() - interval '4 hours'),
  ('10000000-0000-4000-8000-000000009522', 'POTHOLE', 'ASSIGNED',    'HIGH', 'CRITICAL', 'CRITICAL', 'd0000000-0000-4000-8000-000000009501', null, 'SRID=4326;POINT(72.95 18.98)', now() - interval '6 hours'),
  ('10000000-0000-4000-8000-000000009531', 'POTHOLE', 'REPORTED',    null, null, null, null, null, 'SRID=4326;POINT(72.95 18.985)', now() - interval '6 hours'),
  ('10000000-0000-4000-8000-000000009532', 'POTHOLE', 'REPORTED',    null, null, null, null, null, 'SRID=4326;POINT(72.95 18.985)', now() - interval '6 hours'),
  ('10000000-0000-4000-8000-000000009533', 'POTHOLE', 'IN_PROGRESS', null, null, null, 'd0000000-0000-4000-8000-000000009501', null, 'SRID=4326;POINT(72.95 18.985)', now() - interval '6 hours'),
  ('10000000-0000-4000-8000-000000009541', 'POTHOLE', 'RESOLVED',    null, null, null, 'd0000000-0000-4000-8000-000000009501', now(), 'SRID=4326;POINT(72.95 18.99)', now() - interval '6 hours'),
  ('10000000-0000-4000-8000-000000009542', 'POTHOLE', 'REJECTED',    null, null, null, null, null, 'SRID=4326;POINT(72.95 18.99)', now() - interval '6 hours'),
  ('10000000-0000-4000-8000-000000009544', 'POTHOLE', 'REPORTED',    null, null, null, null, null, 'SRID=4326;POINT(72.95 18.99)', now() - interval '6 hours'),
  ('10000000-0000-4000-8000-000000009545', 'POTHOLE', 'REOPENED',    null, null, null, 'd0000000-0000-4000-8000-000000009501', now(), 'SRID=4326;POINT(72.95 18.99)', now() - interval '6 hours'),
  ('10000000-0000-4000-8000-000000009546', 'POTHOLE', 'IN_PROGRESS', null, null, null, 'd0000000-0000-4000-8000-000000009501', null, 'SRID=4326;POINT(72.95 18.99)', now() - interval '6 hours');
insert into public.issues (id, category, status, merged_into_issue_id, geom, created_at) values
  -- an earlier merge into the source 21
  ('10000000-0000-4000-8000-000000009520', 'GARBAGE', 'MERGED', '10000000-0000-4000-8000-000000009521', 'SRID=4326;POINT(72.951 18.98)', now() - interval '5 hours'),
  ('10000000-0000-4000-8000-000000009543', 'POTHOLE', 'MERGED', '10000000-0000-4000-8000-000000009544', 'SRID=4326;POINT(72.95 18.99)', now() - interval '6 hours');
-- 21's reports: …9523 is older but has the larger id and is inserted last.
insert into public.reports (id, issue_id, reporter_user_id, reporter_ip_hash, category, description, image_path, geom, created_at) values
  ('20000000-0000-4000-8000-000000009522', '10000000-0000-4000-8000-000000009521', '00000000-0000-4000-8000-000000009512', 'iphash-095-c2',
   'GARBAGE', 'newer on 21', '00000000-0000-4000-8000-000000009512/x.jpg', 'SRID=4326;POINT(72.951 18.98)', now() - interval '3 hours'),
  ('20000000-0000-4000-8000-000000009521', '10000000-0000-4000-8000-000000009522', '00000000-0000-4000-8000-000000009513', 'iphash-095-c3',
   'POTHOLE', 'on 22', '00000000-0000-4000-8000-000000009513/x.jpg', 'SRID=4326;POINT(72.95 18.98)', now() - interval '6 hours'),
  ('20000000-0000-4000-8000-000000009523', '10000000-0000-4000-8000-000000009521', '00000000-0000-4000-8000-000000009511', 'iphash-095-c1',
   'GARBAGE', 'older on 21', '00000000-0000-4000-8000-000000009511/x.jpg', 'SRID=4326;POINT(72.951 18.98)', now() - interval '4 hours'),
  ('20000000-0000-4000-8000-000000009531', '10000000-0000-4000-8000-000000009531', '00000000-0000-4000-8000-000000009513', 'iphash-095-c3',
   'POTHOLE', 'on 31', '00000000-0000-4000-8000-000000009513/x.jpg', 'SRID=4326;POINT(72.95 18.985)', now() - interval '6 hours'),
  ('20000000-0000-4000-8000-000000009532', '10000000-0000-4000-8000-000000009532', '00000000-0000-4000-8000-000000009513', 'iphash-095-c3',
   'POTHOLE', 'on 32', '00000000-0000-4000-8000-000000009513/x.jpg', 'SRID=4326;POINT(72.95 18.985)', now() - interval '5 hours');

-- Back-date updated_at (bypassing the touch trigger) so a bump to now() is detectable.
set local session_replication_role = replica;
update public.issues set updated_at = now() - interval '1 day' where id::text like '10000000-0000-4000-8000-0000000095%';
set local session_replication_role = origin;

-- add_supporting_report: happy path -------------------------------------------------------------
set local role service_role;
do $$
declare
  res jsonb; before public.issues%rowtype; i public.issues%rowtype; r public.reports%rowtype; e public.issue_events%rowtype;
  n_hotspots int := (select count(*) from public.hotspots);
begin
  select * into strict before from public.issues where id = pg_temp.iid('01');
  res := public.add_supporting_report('00000000-0000-4000-8000-000000009512', 'iphash-095-c2', pg_temp.iid('01'), 'POTHOLE', 'CRITICAL',
                                      E' \t Deep one, bike fell \n', '00000000-0000-4000-8000-000000009512/00000000-0000-4000-8000-000000000095.jpg',
                                      18.9702, 72.9503, pg_temp.scfg());
  perform pg_temp.assert_eq('result keys', pg_temp.keys(res), array['issue_id', 'report_id']);
  perform pg_temp.assert_eq('result issue_id', res ->> 'issue_id', pg_temp.iid('01')::text);

  select * into strict r from public.reports where id = (res ->> 'report_id')::uuid;
  perform pg_temp.assert_eq('report issue', r.issue_id, pg_temp.iid('01'));
  perform pg_temp.assert_eq('report reporter', r.reporter_user_id, '00000000-0000-4000-8000-000000009512'::uuid);
  perform pg_temp.assert_eq('report ip hash', r.reporter_ip_hash, 'iphash-095-c2');
  perform pg_temp.assert_eq('report category', r.category, 'POTHOLE'::public.issue_category);
  perform pg_temp.assert_eq('report citizen_severity', r.citizen_severity, 'CRITICAL'::public.level);
  perform pg_temp.assert_eq('report description trimmed', r.description, 'Deep one, bike fell');
  perform pg_temp.assert_eq('report image_path', r.image_path, '00000000-0000-4000-8000-000000009512/00000000-0000-4000-8000-000000000095.jpg');
  perform pg_temp.assert_eq('report lat = pinned point', round(st_y(r.geom::geometry)::numeric, 6), 18.9702);
  perform pg_temp.assert_eq('report lng = pinned point', round(st_x(r.geom::geometry)::numeric, 6), 72.9503);
  perform pg_temp.assert_eq('report created now', r.created_at, now());

  select * into strict i from public.issues where id = pg_temp.iid('01');
  perform pg_temp.assert_eq('issue unchanged except updated_at',
    row(i.category, i.status, i.citizen_severity, i.authority_severity, i.final_priority, i.assigned_department_id,
        i.merged_into_issue_id, i.resolved_at, i.created_at, st_astext(i.geom::geometry))::text,
    row(before.category, before.status, before.citizen_severity, before.authority_severity, before.final_priority,
        before.assigned_department_id, before.merged_into_issue_id, before.resolved_at, before.created_at,
        st_astext(before.geom::geometry))::text);
  perform pg_temp.assert_eq('issue updated_at bumped', i.updated_at, now());
  perform pg_temp.assert_eq('issue now has 2 reports', (select count(*)::int from public.reports where issue_id = i.id), 2);

  perform pg_temp.assert_eq('one event', (select count(*)::int from public.issue_events where issue_id = i.id), 1);
  select * into strict e from public.issue_events where issue_id = i.id;
  perform pg_temp.assert_eq('event', row(e.event_type, e.actor_user_id, e.from_status, e.to_status, e.note)::text,
    row('SUPPORT_ADDED', '00000000-0000-4000-8000-000000009512'::uuid, null::public.issue_status, null::public.issue_status, null::text)::text);
  perform pg_temp.assert_eq('event metadata', e.metadata, jsonb_build_object('report_id', r.id));

  perform pg_temp.assert_eq('no City Pulse run', (select count(*)::int from public.hotspots), n_hotspots);

  -- FAMILY category: a WATERLOGGING report supports a DRAINAGE issue; the report keeps its own category
  res := pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('02'), 'WATERLOGGING');
  perform pg_temp.assert_eq('family support issue', res ->> 'issue_id', pg_temp.iid('02')::text);
  perform pg_temp.assert_eq('family report category', (select category from public.reports where id = (res ->> 'report_id')::uuid),
    'WATERLOGGING'::public.issue_category);
  select * into strict i from public.issues where id = pg_temp.iid('02');
  perform pg_temp.assert_eq('family: issue category kept', i.category, 'DRAINAGE'::public.issue_category);
  perform pg_temp.assert_eq('family: issue status kept', i.status, 'ASSIGNED'::public.issue_status);
  perform pg_temp.assert_eq('family: null ip hash stored', (select reporter_ip_hash from public.reports where id = (res ->> 'report_id')::uuid), null::text);

  -- families come from p_config
  res := pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'GARBAGE',
                     pg_temp.scfg(p_families => '[["POTHOLE", "GARBAGE"]]'));
  perform pg_temp.assert_eq('configured family', res ->> 'issue_id', pg_temp.iid('01')::text);

  -- MERGED issue → attaches to its target and returns the target id
  res := pg_temp.sup('00000000-0000-4000-8000-000000009513', pg_temp.iid('07'), 'GARBAGE');
  perform pg_temp.assert_eq('merged: returns target', res ->> 'issue_id', pg_temp.iid('06')::text);
  perform pg_temp.assert_eq('merged: report on target', (select issue_id from public.reports where id = (res ->> 'report_id')::uuid), pg_temp.iid('06'));
  perform pg_temp.assert_eq('merged: event on target',
    (select count(*)::int from public.issue_events where issue_id = pg_temp.iid('06') and event_type = 'SUPPORT_ADDED'), 1);
  perform pg_temp.assert_eq('merged: nothing on the merged issue',
    (select count(*)::int from public.issue_events where issue_id = pg_temp.iid('07')), 0);
  perform pg_temp.assert_eq('merged: merged issue untouched',
    (select updated_at from public.issues where id = pg_temp.iid('07')), now() - interval '1 day');
end $$;
reset role;

-- add_supporting_report: refusals ---------------------------------------------------------------
set local role service_role;
do $$
declare v_before text := pg_temp.snapshot();
begin
  -- incompatible category
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('02'), 'POTHOLE')$q$,
    'PT400', 'VALIDATION_FAILED', 'category does not match this issue');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'GARBAGE')$q$,
    'PT400', 'VALIDATION_FAILED', 'category does not match this issue');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('02'), 'WATERLOGGING', pg_temp.scfg(p_families => '[]'))$q$,
    'PT400', 'VALIDATION_FAILED', 'category does not match this issue');
  -- closed issues (REOPENED is the stretch and not open)
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('03'), 'GARBAGE')$q$,
    'PT409', 'CONFLICT', 'issue is closed');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('04'), 'GARBAGE')$q$,
    'PT409', 'CONFLICT', 'issue is closed');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('05'), 'GARBAGE')$q$,
    'PT409', 'CONFLICT', 'issue is closed');
  -- closed beats category mismatch
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('03'), 'POTHOLE')$q$,
    'PT409', 'CONFLICT', 'issue is closed');
  -- MERGED into an issue that has since closed
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('09'), 'GARBAGE')$q$,
    'PT409', 'CONFLICT', 'issue is closed');
  -- missing
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('ff'), 'GARBAGE')$q$,
    'PT404', 'NOT_FOUND', 'issue not found');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', null, 'GARBAGE')$q$,
    'PT404', 'NOT_FOUND', 'issue not found');
  -- photo and input checks (same as create_report)
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'POTHOLE', null, null,
       '00000000-0000-4000-8000-000000009512/00000000-0000-4000-8000-000000000095.jpg')$q$,
    'PT403', 'FORBIDDEN', 'image_path is not in the caller''s folder');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'POTHOLE', null, null,
       '00000000-0000-4000-8000-000000009511/00000000-0000-4000-8000-0000000000ff.jpg')$q$,
    'PT400', 'VALIDATION_FAILED', 'photo not found in storage');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'POTHOLE', null, null,
       '00000000-0000-4000-8000-000000009511/00000000-0000-4000-8000-000000000096.jpg')$q$,
    'PT400', 'VALIDATION_FAILED', 'photo not found in storage');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'POTHOLE', null, null, null, E' \n ')$q$,
    'PT400', 'VALIDATION_FAILED', 'description required');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), null)$q$,
    'PT400', 'VALIDATION_FAILED', 'category required');
  perform pg_temp.expect_error($q$select public.add_supporting_report('00000000-0000-4000-8000-000000009511', null, pg_temp.iid('01'), 'POTHOLE', null, 'x',
       '00000000-0000-4000-8000-000000009511/00000000-0000-4000-8000-000000000095.jpg', 91, 72.95, pg_temp.scfg())$q$,
    'PT400', 'VALIDATION_FAILED', 'invalid location');
  perform pg_temp.expect_error($q$select pg_temp.sup(null, pg_temp.iid('01'), 'POTHOLE', null, null, 'x/y.jpg')$q$,
    'PT403', 'FORBIDDEN', 'actor required');
  -- config keys are required (programming error → INTERNAL)
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'POTHOLE', pg_temp.scfg() - 'compatible_families')$q$, '22023');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('01'), 'POTHOLE', pg_temp.scfg() - 'window_hours')$q$, '22023');

  perform pg_temp.assert_eq('refused calls wrote nothing', pg_temp.snapshot(), v_before);
end $$;
reset role;

-- add_supporting_report: rate limits (02 §9, numbers from p_config) -----------------------------
set local role service_role;
do $$ begin
  -- per user: C4 has no reports; limit 1 → the 2nd is refused
  perform pg_temp.sup('00000000-0000-4000-8000-000000009514', pg_temp.iid('10'), 'POTHOLE', pg_temp.scfg(p_user => 1));
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009514', pg_temp.iid('10'), 'POTHOLE', pg_temp.scfg(p_user => 1))$q$,
    'PT429', 'RATE_LIMITED', 'per-user limit');
  -- the support counts towards create_report's limit too (same reports table)
  perform pg_temp.expect_error($q$select public.create_report('00000000-0000-4000-8000-000000009514', null, 'POTHOLE', null, 'x',
       '00000000-0000-4000-8000-000000009514/00000000-0000-4000-8000-000000000095.jpg', 18.97, 72.95,
       '{"window_hours": 1, "max_reports_per_user": 1, "max_reports_per_ip_hash": 100}')$q$,
    'PT429', 'RATE_LIMITED', 'per-user limit');
  perform pg_temp.sup('00000000-0000-4000-8000-000000009514', pg_temp.iid('10'), 'POTHOLE', pg_temp.scfg(p_user => 2));

  -- per IP hash: limit 1 across users
  perform pg_temp.sup('00000000-0000-4000-8000-000000009512', pg_temp.iid('10'), 'POTHOLE', pg_temp.scfg(p_ip => 1), 'iphash-095-shared');
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009513', pg_temp.iid('10'), 'POTHOLE', pg_temp.scfg(p_ip => 1), 'iphash-095-shared')$q$,
    'PT429', 'RATE_LIMITED', 'per-IP limit');
  perform pg_temp.assert_eq('C4 reports', (select count(*)::int from public.reports where reporter_user_id = '00000000-0000-4000-8000-000000009514'), 2);
  perform pg_temp.assert_eq('shared-hash reports', (select count(*)::int from public.reports where reporter_ip_hash = 'iphash-095-shared'), 1);
end $$;
reset role;

-- merge_issue: refusals (nothing written) --------------------------------------------------------
set local role service_role;
do $$
declare v_before text := pg_temp.snapshot(); a text;
begin
  -- non-authority (citizen, unknown, null) → FORBIDDEN, before anything is looked up
  foreach a in array array['''00000000-0000-4000-8000-000000009511''', '''00000000-0000-4000-8000-0000000095ff''', 'null'] loop
    perform pg_temp.expect_error(format('select public.merge_issue(%s, pg_temp.iid(''21''), pg_temp.iid(''22''), null)', a), 'PT403', 'FORBIDDEN');
    perform pg_temp.expect_error(format('select public.merge_issue(%s, pg_temp.iid(''ff''), pg_temp.iid(''21''), null)', a), 'PT403', 'FORBIDDEN');
  end loop;
  -- same issue
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('21'), pg_temp.iid('21'), null)$q$,
    'PT400', 'VALIDATION_FAILED', 'cannot merge an issue into itself');
  -- missing
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('ff'), pg_temp.iid('22'), null)$q$,
    'PT404', 'NOT_FOUND', 'source issue not found');
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('21'), pg_temp.iid('ff'), null)$q$,
    'PT404', 'NOT_FOUND', 'target issue not found');
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', null, pg_temp.iid('22'), null)$q$,
    'PT404', 'NOT_FOUND');
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('21'), null, null)$q$,
    'PT404', 'NOT_FOUND');
  -- source not mergeable (status_transition_rules)
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('41'), pg_temp.iid('44'), null)$q$,
    'PT409', 'INVALID_TRANSITION', 'RESOLVED -> MERGED not allowed');
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('42'), pg_temp.iid('44'), null)$q$,
    'PT409', 'INVALID_TRANSITION', 'REJECTED -> MERGED not allowed');
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('43'), pg_temp.iid('46'), null)$q$,
    'PT409', 'INVALID_TRANSITION', 'MERGED -> MERGED not allowed');
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('45'), pg_temp.iid('44'), null)$q$,
    'PT409', 'INVALID_TRANSITION', 'REOPENED -> MERGED not allowed');
  -- target closed
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('44'), pg_temp.iid('41'), null)$q$,
    'PT409', 'CONFLICT', 'target issue is closed');
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('44'), pg_temp.iid('42'), null)$q$,
    'PT409', 'CONFLICT', 'target issue is closed');
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('44'), pg_temp.iid('43'), null)$q$,
    'PT409', 'CONFLICT', 'target issue is closed');
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('44'), pg_temp.iid('45'), null)$q$,
    'PT409', 'CONFLICT', 'target issue is closed');

  perform pg_temp.assert_eq('refused merges wrote nothing', pg_temp.snapshot(), v_before);
end $$;
reset role;

-- merge_issue: happy path ------------------------------------------------------------------------
set local role service_role;
do $$
declare
  res jsonb; t_before public.issues%rowtype; s public.issues%rowtype; t public.issues%rowtype; e public.issue_events%rowtype;
  v_moved jsonb := '["20000000-0000-4000-8000-000000009523", "20000000-0000-4000-8000-000000009522"]';
  my jsonb;
begin
  select * into strict t_before from public.issues where id = pg_temp.iid('22');
  res := public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('21'), pg_temp.iid('22'), E'  same pothole, see photos \n');

  perform pg_temp.assert_eq('result keys', pg_temp.keys(res), array['moved_report_ids', 'source_issue_id', 'target_issue_id']);
  perform pg_temp.assert_eq('result source', res ->> 'source_issue_id', pg_temp.iid('21')::text);
  perform pg_temp.assert_eq('result target', res ->> 'target_issue_id', pg_temp.iid('22')::text);
  perform pg_temp.assert_eq('moved ids, oldest report first', res -> 'moved_report_ids', v_moved);

  -- reports moved
  perform pg_temp.assert_eq('source has no reports', (select count(*)::int from public.reports where issue_id = pg_temp.iid('21')), 0);
  perform pg_temp.assert_eq('target reports', (select array_agg(id::text order by created_at) from public.reports where issue_id = pg_temp.iid('22')),
    array['20000000-0000-4000-8000-000000009521', '20000000-0000-4000-8000-000000009523', '20000000-0000-4000-8000-000000009522']);
  -- moved rows keep their own content
  perform pg_temp.assert_eq('moved report keeps its category', (select category from public.reports where id = '20000000-0000-4000-8000-000000009523'),
    'GARBAGE'::public.issue_category);

  -- source
  select * into strict s from public.issues where id = pg_temp.iid('21');
  perform pg_temp.assert_eq('source status', s.status, 'MERGED'::public.issue_status);
  perform pg_temp.assert_eq('source merged_into', s.merged_into_issue_id, pg_temp.iid('22'));
  -- earlier merge repointed
  perform pg_temp.assert_eq('earlier merge repointed', (select merged_into_issue_id from public.issues where id = pg_temp.iid('20')), pg_temp.iid('22'));

  -- target keeps its own fields
  select * into strict t from public.issues where id = pg_temp.iid('22');
  perform pg_temp.assert_eq('target unchanged except updated_at',
    row(t.category, t.status, t.citizen_severity, t.authority_severity, t.final_priority, t.assigned_department_id,
        t.assigned_at, t.sla_due_at, t.merged_into_issue_id, t.created_at, st_astext(t.geom::geometry))::text,
    row(t_before.category, t_before.status, t_before.citizen_severity, t_before.authority_severity, t_before.final_priority,
        t_before.assigned_department_id, t_before.assigned_at, t_before.sla_due_at, t_before.merged_into_issue_id,
        t_before.created_at, st_astext(t_before.geom::geometry))::text);
  perform pg_temp.assert_eq('target updated_at bumped', t.updated_at, now());

  -- events
  perform pg_temp.assert_eq('one event on source', (select count(*)::int from public.issue_events where issue_id = pg_temp.iid('21')), 1);
  select * into strict e from public.issue_events where issue_id = pg_temp.iid('21');
  perform pg_temp.assert_eq('MERGED_INTO', row(e.event_type, e.actor_user_id, e.from_status, e.to_status, e.note)::text,
    row('MERGED_INTO', '00000000-0000-4000-8000-000000009501'::uuid, 'REPORTED'::public.issue_status, 'MERGED'::public.issue_status,
        'same pothole, see photos')::text);
  perform pg_temp.assert_eq('MERGED_INTO metadata', e.metadata,
    jsonb_build_object('target_issue_id', pg_temp.iid('22'), 'moved_report_ids', v_moved));
  perform pg_temp.assert_eq('one event on target', (select count(*)::int from public.issue_events where issue_id = pg_temp.iid('22')), 1);
  select * into strict e from public.issue_events where issue_id = pg_temp.iid('22');
  perform pg_temp.assert_eq('MERGED_FROM', row(e.event_type, e.actor_user_id, e.from_status, e.to_status, e.note)::text,
    row('MERGED_FROM', '00000000-0000-4000-8000-000000009501'::uuid, null::public.issue_status, null::public.issue_status,
        'same pothole, see photos')::text);
  perform pg_temp.assert_eq('MERGED_FROM metadata', e.metadata,
    jsonb_build_object('source_issue_id', pg_temp.iid('21'), 'moved_report_ids', v_moved));
  perform pg_temp.assert_eq('no event on the repointed issue', (select count(*)::int from public.issue_events where issue_id = pg_temp.iid('20')), 0);

  -- My Reports follows the report row to the target
  my := public.my_reports('00000000-0000-4000-8000-000000009511');
  perform pg_temp.assert_eq('my_reports: moved report shows the target',
    (select e2 #>> '{issue,id}' from jsonb_array_elements(my) e2 where e2 ->> 'id' = '20000000-0000-4000-8000-000000009523'),
    pg_temp.iid('22')::text);
  perform pg_temp.assert_eq('my_reports: target status',
    (select e2 #>> '{issue,status}' from jsonb_array_elements(my) e2 where e2 ->> 'id' = '20000000-0000-4000-8000-000000009523'), 'ASSIGNED');
  perform pg_temp.assert_eq('my_reports: target report_count',
    (select (e2 #>> '{issue,report_count}')::int from jsonb_array_elements(my) e2 where e2 ->> 'id' = '20000000-0000-4000-8000-000000009523'), 3);

  -- supporting the merged source now lands on the target
  res := pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('21'), 'POTHOLE');
  perform pg_temp.assert_eq('support on merged source → target', res ->> 'issue_id', pg_temp.iid('22')::text);
  -- … and its category is checked against the target (POTHOLE), not the source (GARBAGE)
  perform pg_temp.expect_error($q$select pg_temp.sup('00000000-0000-4000-8000-000000009511', pg_temp.iid('21'), 'GARBAGE')$q$,
    'PT400', 'VALIDATION_FAILED', 'category does not match this issue');
  -- merging a MERGED source again is refused
  perform pg_temp.expect_error($q$select public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('21'), pg_temp.iid('44'), null)$q$,
    'PT409', 'INVALID_TRANSITION', 'MERGED -> MERGED not allowed');

  -- blank note → null; an IN_PROGRESS source; a source with no reports
  res := public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('46'), pg_temp.iid('44'), E' \t ');
  perform pg_temp.assert_eq('no reports moved', res -> 'moved_report_ids', '[]'::jsonb);
  select * into strict e from public.issue_events where issue_id = pg_temp.iid('46');
  perform pg_temp.assert_eq('IN_PROGRESS source event', row(e.from_status, e.to_status, e.note)::text,
    row('IN_PROGRESS'::public.issue_status, 'MERGED'::public.issue_status, null::text)::text);
  perform pg_temp.assert_eq('IN_PROGRESS source keeps its department',
    (select assigned_department_id from public.issues where id = pg_temp.iid('46')), 'd0000000-0000-4000-8000-000000009501'::uuid);
  perform pg_temp.assert_eq('MERGED_FROM note null',
    (select note from public.issue_events where issue_id = pg_temp.iid('44') and event_type = 'MERGED_FROM'), null::text);
end $$;
reset role;

-- merge_issue: no chains -------------------------------------------------------------------------
set local role service_role;
do $$ declare res jsonb; begin
  -- 31 → 32, then 32 → 33: 31 must point straight at 33
  res := public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('31'), pg_temp.iid('32'), null);
  perform pg_temp.assert_eq('first merge moved', res -> 'moved_report_ids', '["20000000-0000-4000-8000-000000009531"]'::jsonb);
  res := public.merge_issue('00000000-0000-4000-8000-000000009501', pg_temp.iid('32'), pg_temp.iid('33'), 'dup');
  perform pg_temp.assert_eq('second merge moves both reports, oldest first', res -> 'moved_report_ids',
    '["20000000-0000-4000-8000-000000009531", "20000000-0000-4000-8000-000000009532"]'::jsonb);
  perform pg_temp.assert_eq('A.merged_into = C', (select merged_into_issue_id from public.issues where id = pg_temp.iid('31')), pg_temp.iid('33'));
  perform pg_temp.assert_eq('B.merged_into = C', (select merged_into_issue_id from public.issues where id = pg_temp.iid('32')), pg_temp.iid('33'));
  perform pg_temp.assert_eq('C reports', (select count(*)::int from public.reports where issue_id = pg_temp.iid('33')), 2);
  perform pg_temp.assert_eq('C status kept', (select status from public.issues where id = pg_temp.iid('33')), 'IN_PROGRESS'::public.issue_status);
  -- support on A follows to C
  perform pg_temp.assert_eq('support on A → C', pg_temp.sup('00000000-0000-4000-8000-000000009512', pg_temp.iid('31'), 'POTHOLE') ->> 'issue_id',
    pg_temp.iid('33')::text);
  -- no issue anywhere points at a MERGED issue
  perform pg_temp.assert_eq('no merge chains', (
    select count(*)::int from public.issues i join public.issues t on t.id = i.merged_into_issue_id where t.status = 'MERGED'), 0);
end $$;
reset role;

rollback;

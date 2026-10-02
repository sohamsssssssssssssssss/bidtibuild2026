-- Read functions: map_issues (20261002000700_read_functions.sql), issue_detail and my_reports
-- (replaced in 20261002000900_photo_route.sql: photo references, never storage paths).
-- Own fixtures (does not depend on the seed); one transaction, rolled back.
begin;

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

-- Fixture ids (10000000-…) returned by a map_issues call, sorted. Other rows (e.g. the seed, when
-- it is loaded) are ignored so the test does not depend on it.
create function pg_temp.map_ids(p_box double precision[], p_cats public.issue_category[], p_stats public.issue_status[])
returns uuid[] language sql as $$
  select coalesce(array_agg(id order by id), '{}')
  from public.map_issues(p_box[1], p_box[2], p_box[3], p_box[4], p_cats, p_stats)
  where id::text like '10000000-0000-4000-8000-%'
$$;

create function pg_temp.assert_eq(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception '%: expected % got %', p_label, p_want, p_got; end if;
end $$;

-- Privileges -------------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'public.map_issues(double precision, double precision, double precision, double precision, public.issue_category[], public.issue_status[])',
    'public.issue_detail(uuid, uuid)',
    'public.my_reports(uuid)'
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
  end loop;
end $$;

set local role authenticated;
select pg_temp.expect_error($q$select public.my_reports('00000000-0000-4000-8000-0000000000c1')$q$, '42501');
select pg_temp.expect_error($q$select public.issue_detail('10000000-0000-4000-8000-000000000001', null)$q$, '42501');
select pg_temp.expect_error($q$select * from public.map_issues(72.8, 19.0, 72.9, 19.1, null, null)$q$, '42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.map_issues(72.8, 19.0, 72.9, 19.1, null, null)$q$, '42501');
select pg_temp.expect_error($q$select public.issue_detail('10000000-0000-4000-8000-000000000001', null)$q$, '42501');
reset role;

-- Fixtures (superuser) ---------------------------------------------------------------------------
-- A1 authority; C1, C2, C3 citizens; C9 has no reports.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'authority@test.local');
insert into public.users (id, name, email) values ('00000000-0000-4000-8000-0000000000a1', 'Test Authority', 'authority@test.local');
insert into public.departments (id, name, sla_hours) values ('00000000-0000-4000-8000-0000000000d1', 'Test Roads', 72);

-- I1 POTHOLE REPORTED, I2 GARBAGE ASSIGNED, I3 POTHOLE REJECTED, I4 DRAINAGE (merged into I1 below),
-- I5 STREETLIGHT RESOLVED — all inside the box (72.8,19.0)-(72.9,19.1); I6 POTHOLE far outside.
insert into public.issues (id, category, status, geom, assigned_department_id, assigned_at, sla_due_at, resolved_at, final_priority, created_at) values
  ('10000000-0000-4000-8000-000000000001', 'POTHOLE',     'REPORTED', 'SRID=4326;POINT(72.83 19.05)', null, null, null, null, 'HIGH', now() - interval '5 hours'),
  ('10000000-0000-4000-8000-000000000002', 'GARBAGE',     'ASSIGNED', 'SRID=4326;POINT(72.84 19.06)', '00000000-0000-4000-8000-0000000000d1', now(), now() + interval '72 hours', null, null, now() - interval '4 hours'),
  ('10000000-0000-4000-8000-000000000003', 'POTHOLE',     'REJECTED', 'SRID=4326;POINT(72.85 19.07)', null, null, null, null, null, now() - interval '3 hours'),
  ('10000000-0000-4000-8000-000000000004', 'DRAINAGE',    'REPORTED', 'SRID=4326;POINT(72.86 19.08)', null, null, null, null, null, now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000000005', 'STREETLIGHT', 'RESOLVED', 'SRID=4326;POINT(72.87 19.02)', '00000000-0000-4000-8000-0000000000d1', now(), now(), now() - interval '30 minutes', null, now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000006', 'POTHOLE',     'REPORTED', 'SRID=4326;POINT(73.50 18.50)', null, null, null, null, null, now());

insert into public.reports (id, issue_id, reporter_user_id, reporter_ip_hash, category, citizen_severity, description, image_path, geom, created_at) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'iphash-secret-1', 'POTHOLE', 'HIGH', 'first pothole report', '00000000-0000-4000-8000-0000000000c1/50000000-0000-4000-8000-000000000001.jpg', 'SRID=4326;POINT(72.83 19.05)', now() - interval '5 hours'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c2', 'iphash-secret-2', 'POTHOLE', null, 'support', '00000000-0000-4000-8000-0000000000c2/50000000-0000-4000-8000-000000000002.jpg', 'SRID=4326;POINT(72.8301 19.0501)', now() - interval '4 hours 30 minutes'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000c2', 'iphash-secret-2', 'GARBAGE', null, 'garbage', '00000000-0000-4000-8000-0000000000c2/50000000-0000-4000-8000-000000000003.jpg', 'SRID=4326;POINT(72.84 19.06)', now() - interval '4 hours'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c1', 'iphash-secret-1', 'POTHOLE', null, 'rejected one', '00000000-0000-4000-8000-0000000000c1/50000000-0000-4000-8000-000000000004.jpg', 'SRID=4326;POINT(72.85 19.07)', now() - interval '3 hours'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000c3', 'iphash-secret-3', 'DRAINAGE', null, 'drain', '00000000-0000-4000-8000-0000000000c3/50000000-0000-4000-8000-000000000005.jpg', 'SRID=4326;POINT(72.86 19.08)', now() - interval '2 hours'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000c1', 'iphash-secret-1', 'STREETLIGHT', 'LOW', 'light', '00000000-0000-4000-8000-0000000000c1/50000000-0000-4000-8000-000000000006.jpg', 'SRID=4326;POINT(72.87 19.02)', now() - interval '1 hour'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000c2', 'iphash-secret-2', 'POTHOLE', null, 'far', '00000000-0000-4000-8000-0000000000c2/50000000-0000-4000-8000-000000000007.jpg', 'SRID=4326;POINT(73.50 18.50)', now());

insert into public.issue_events (id, issue_id, actor_user_id, event_type, from_status, to_status, note, metadata, created_at) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'CREATED', null, 'REPORTED', null, '{}', now() - interval '5 hours'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'PRIORITY_SET', null, null, 'urgent', '{}', now() - interval '4 hours 45 minutes'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', null, 'SUPPORT_ADDED', null, null, null,
   '{"report_id":"30000000-0000-4000-8000-000000000002","reporter":"00000000-0000-4000-8000-0000000000c2"}', now() - interval '4 hours 30 minutes'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c1', 'CREATED', null, 'REPORTED', null, '{}', now() - interval '3 hours'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', 'REJECTED', 'REPORTED', 'REJECTED', 'not a civic issue', '{}', now() - interval '2 hours 50 minutes');

insert into public.resolution_evidence (id, issue_id, uploaded_by, image_path, note, created_at) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1/60000000-0000-4000-8000-000000000001.jpg', 'first fix', now() - interval '40 minutes'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1/60000000-0000-4000-8000-000000000002.jpg', 'final fix', now() - interval '30 minutes');

-- my_reports before the merge: C3's report is on I4 -------------------------------------------------
select pg_temp.assert_eq('C3 report issue before merge',
  public.my_reports('00000000-0000-4000-8000-0000000000c3') -> 0 -> 'issue' ->> 'id', '10000000-0000-4000-8000-000000000004');
select pg_temp.assert_eq('map before merge includes I4',
  '10000000-0000-4000-8000-000000000004'::uuid = any (pg_temp.map_ids('{72.8,19.0,72.9,19.1}', null, null)), true);

-- Merge I4 into I1 the way merge_issue will (02 §3.7): move reports, mark source MERGED.
update public.reports set issue_id = '10000000-0000-4000-8000-000000000001' where issue_id = '10000000-0000-4000-8000-000000000004';
update public.issues set status = 'MERGED', merged_into_issue_id = '10000000-0000-4000-8000-000000000001' where id = '10000000-0000-4000-8000-000000000004';

-- map_issues ------------------------------------------------------------------------------------
select pg_temp.assert_eq('bbox: rejected, merged and outside excluded',
  pg_temp.map_ids('{72.8,19.0,72.9,19.1}', null, null),
  '{10000000-0000-4000-8000-000000000001,10000000-0000-4000-8000-000000000002,10000000-0000-4000-8000-000000000005}'::uuid[]);
select pg_temp.assert_eq('small bbox around I1 only',
  pg_temp.map_ids('{72.825,19.045,72.835,19.055}', null, null), '{10000000-0000-4000-8000-000000000001}'::uuid[]);
select pg_temp.assert_eq('empty bbox',
  pg_temp.map_ids('{10,10,11,11}', null, null), '{}'::uuid[]);
select pg_temp.assert_eq('world bbox (no index pre-filter) still excludes rejected/merged',
  pg_temp.map_ids('{-180,-90,180,90}', null, null),
  '{10000000-0000-4000-8000-000000000001,10000000-0000-4000-8000-000000000002,10000000-0000-4000-8000-000000000005,10000000-0000-4000-8000-000000000006}'::uuid[]);
select pg_temp.assert_eq('category filter',
  pg_temp.map_ids('{72.8,19.0,72.9,19.1}', '{POTHOLE}', null), '{10000000-0000-4000-8000-000000000001}'::uuid[]);
select pg_temp.assert_eq('status filter',
  pg_temp.map_ids('{72.8,19.0,72.9,19.1}', null, '{ASSIGNED,RESOLVED}'),
  '{10000000-0000-4000-8000-000000000002,10000000-0000-4000-8000-000000000005}'::uuid[]);
select pg_temp.assert_eq('category + status filter',
  pg_temp.map_ids('{72.8,19.0,72.9,19.1}', '{GARBAGE,POTHOLE}', '{ASSIGNED}'), '{10000000-0000-4000-8000-000000000002}'::uuid[]);
select pg_temp.assert_eq('REJECTED/MERGED never returned even when asked for',
  pg_temp.map_ids('{72.8,19.0,72.9,19.1}', null, '{REJECTED,MERGED}'), '{}'::uuid[]);

do $$ declare m record; begin
  select * into strict m from public.map_issues(72.8, 19.0, 72.9, 19.1, '{POTHOLE}', null) where id = '10000000-0000-4000-8000-000000000001';
  perform pg_temp.assert_eq('marker lat', round(m.lat::numeric, 6), 19.05);
  perform pg_temp.assert_eq('marker lng', round(m.lng::numeric, 6), 72.83);
  perform pg_temp.assert_eq('marker report_count (incl. merged-in report)', m.report_count, 3);
  perform pg_temp.assert_eq('marker final_priority', m.final_priority, 'HIGH'::public.level);
  perform pg_temp.assert_eq('marker is_seed', m.is_seed, false);
end $$;

-- issue_detail ----------------------------------------------------------------------------------
-- No reporter ids, ip hashes, actor ids, uploader ids or event metadata anywhere in the output, and
-- no storage paths: the fixture paths are {uid}/{uuid}.jpg (02 §10.2), so a path or Storage URL
-- would leak the uploader's uid. Photos are referenced by report / evidence id only.
create function pg_temp.assert_sanitised(p_label text, p_doc jsonb)
returns void language plpgsql as $$
declare s text := p_doc::text; secret text;
begin
  foreach secret in array array[
    '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3',
    'iphash-secret', 'reporter', 'metadata', 'uploaded_by', 'actor_user_id',
    'image_path', '.jpg', 'report-photos', 'resolution-photos', 'storage'
  ] loop
    if position(secret in s) > 0 then raise exception '%: output leaks "%": %', p_label, secret, s; end if;
  end loop;
end $$;

do $$ declare d jsonb; begin
  d := public.issue_detail('10000000-0000-4000-8000-000000000001', null);
  if d is null then raise exception 'I1 detail is null'; end if;
  perform pg_temp.assert_sanitised('I1 detail', d);
  perform pg_temp.assert_eq('I1 status', d ->> 'status', 'REPORTED');
  perform pg_temp.assert_eq('I1 lat', (d ->> 'lat')::numeric, 19.05);
  perform pg_temp.assert_eq('I1 lng', (d ->> 'lng')::numeric, 72.83);
  perform pg_temp.assert_eq('I1 report_count', (d ->> 'report_count')::int, 3);
  perform pg_temp.assert_eq('I1 department', d -> 'department', 'null'::jsonb);
  perform pg_temp.assert_eq('I1 merged_into', d -> 'merged_into_issue_id', 'null'::jsonb);
  perform pg_temp.assert_eq('I1 photos order (primary first)',
    (select array_agg(p ->> 'id' order by o) from jsonb_array_elements(d -> 'photos') with ordinality as t(p, o)),
    array['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005']);
  perform pg_temp.assert_eq('I1 every photo referenced',
    (select bool_and((p ->> 'has_photo')::boolean) from jsonb_array_elements(d -> 'photos') p), true);
  perform pg_temp.assert_eq('I1 primary photo keys',
    (select array_agg(k order by k) from jsonb_object_keys(d -> 'photos' -> 0) k),
    array['category', 'citizen_severity', 'created_at', 'description', 'has_photo', 'id']);
  perform pg_temp.assert_eq('I1 timeline actors',
    (select array_agg(e ->> 'actor' order by o) from jsonb_array_elements(d -> 'timeline') with ordinality as t(e, o)),
    array['CITIZEN', 'AUTHORITY', 'SYSTEM']);
  perform pg_temp.assert_eq('I1 timeline keys',
    (select array_agg(k order by k) from jsonb_object_keys(d -> 'timeline' -> 0) k),
    array['actor', 'created_at', 'event_type', 'from_status', 'id', 'note', 'to_status']);
  perform pg_temp.assert_eq('I1 top-level keys',
    (select array_agg(k order by k) from jsonb_object_keys(d) k),
    array['assigned_at', 'authority_severity', 'category', 'citizen_severity', 'created_at', 'department', 'final_priority',
          'id', 'is_seed', 'lat', 'lng', 'merged_into_issue_id', 'photos', 'report_count', 'resolution_evidence',
          'resolved_at', 'sla_due_at', 'status', 'timeline', 'updated_at']);
  perform pg_temp.assert_eq('I1 evidence', d -> 'resolution_evidence', '[]'::jsonb);

  d := public.issue_detail('10000000-0000-4000-8000-000000000002', null);
  perform pg_temp.assert_eq('I2 department', d -> 'department',
    '{"id":"00000000-0000-4000-8000-0000000000d1","name":"Test Roads"}'::jsonb);

  d := public.issue_detail('10000000-0000-4000-8000-000000000005', null);
  perform pg_temp.assert_sanitised('I5 detail', d);
  perform pg_temp.assert_eq('I5 evidence (oldest first)',
    (select array_agg((e ->> 'id') || '/' || (e ->> 'has_photo') order by o) from jsonb_array_elements(d -> 'resolution_evidence') with ordinality as t(e, o)),
    array['40000000-0000-4000-8000-000000000001/true', '40000000-0000-4000-8000-000000000002/true']);
  perform pg_temp.assert_eq('I5 evidence keys',
    (select array_agg(k order by k) from jsonb_object_keys(d -> 'resolution_evidence' -> 0) k),
    array['created_at', 'has_photo', 'id', 'note']);

  d := public.issue_detail('10000000-0000-4000-8000-000000000004', null);
  perform pg_temp.assert_eq('merged I4 status', d ->> 'status', 'MERGED');
  perform pg_temp.assert_eq('merged I4 target', d ->> 'merged_into_issue_id', '10000000-0000-4000-8000-000000000001');
  perform pg_temp.assert_eq('merged I4 photos moved away', d -> 'photos', '[]'::jsonb);
  perform pg_temp.assert_eq('merged I4 report_count', (d ->> 'report_count')::int, 0);

  perform pg_temp.assert_eq('missing issue', public.issue_detail('10000000-0000-4000-8000-0000000000ff', null), null::jsonb);
end $$;

-- REJECTED visibility mirrors the issues RLS policy; whoever may see the issue may see its photos
-- (photo_object applies the same rule, 075_photos.sql).
do $$ declare d jsonb; begin
  perform pg_temp.assert_eq('rejected, anonymous viewer', public.issue_detail('10000000-0000-4000-8000-000000000003', null), null::jsonb);
  perform pg_temp.assert_eq('rejected, unrelated citizen',
    public.issue_detail('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c2'), null::jsonb);

  d := public.issue_detail('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c1');
  if d is null then raise exception 'rejected issue hidden from its reporter'; end if;
  perform pg_temp.assert_sanitised('rejected, reporter', d);
  perform pg_temp.assert_eq('rejected, reporter: photo referenced', d -> 'photos' -> 0 -> 'has_photo', 'true'::jsonb);
  perform pg_temp.assert_eq('rejected, reporter: description kept', d -> 'photos' -> 0 ->> 'description', 'rejected one');
  perform pg_temp.assert_eq('rejected timeline', (d -> 'timeline' -> 1 ->> 'actor') || '/' || (d -> 'timeline' -> 1 ->> 'note'),
    'AUTHORITY/not a civic issue');

  d := public.issue_detail('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1');
  if d is null then raise exception 'rejected issue hidden from authority'; end if;
  perform pg_temp.assert_sanitised('rejected, authority', d);
  perform pg_temp.assert_eq('rejected, authority: photo referenced', d -> 'photos' -> 0 -> 'has_photo', 'true'::jsonb);
end $$;

-- my_reports ------------------------------------------------------------------------------------
do $$ declare d jsonb; begin
  d := public.my_reports('00000000-0000-4000-8000-0000000000c1');
  perform pg_temp.assert_sanitised('C1 my_reports', d);
  perform pg_temp.assert_eq('C1 reports newest first',
    (select array_agg(r ->> 'id' order by o) from jsonb_array_elements(d) with ordinality as t(r, o)),
    array['30000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001']);
  perform pg_temp.assert_eq('C1 report keys',
    (select array_agg(k order by k) from jsonb_object_keys(d -> 0) k),
    array['category', 'citizen_severity', 'created_at', 'description', 'has_photo', 'id', 'issue', 'lat', 'lng']);
  perform pg_temp.assert_eq('C1 issue keys',
    (select array_agg(k order by k) from jsonb_object_keys(d -> 0 -> 'issue') k),
    array['category', 'final_priority', 'id', 'latest_resolution_evidence', 'report_count', 'resolved_at', 'status', 'updated_at']);
  -- resolved issue: latest evidence
  perform pg_temp.assert_eq('C1 resolved issue status', d -> 0 -> 'issue' ->> 'status', 'RESOLVED');
  perform pg_temp.assert_eq('C1 latest evidence',
    d -> 0 -> 'issue' -> 'latest_resolution_evidence',
    jsonb_build_object('id', '40000000-0000-4000-8000-000000000002', 'has_photo', true, 'note', 'final fix',
                       'created_at', d -> 0 -> 'issue' -> 'latest_resolution_evidence' -> 'created_at'));
  perform pg_temp.assert_eq('C1 own photo', d -> 0 -> 'has_photo', 'true'::jsonb);
  -- rejected issue: the reporter still sees its own photo (photo_object serves it to them)
  perform pg_temp.assert_eq('C1 rejected status', d -> 1 -> 'issue' ->> 'status', 'REJECTED');
  perform pg_temp.assert_eq('C1 rejected own photo', d -> 1 -> 'has_photo', 'true'::jsonb);
  -- open issue with 3 reports, no evidence
  perform pg_temp.assert_eq('C1 I1 report_count', (d -> 2 -> 'issue' ->> 'report_count')::int, 3);
  perform pg_temp.assert_eq('C1 I1 no evidence', d -> 2 -> 'issue' -> 'latest_resolution_evidence', 'null'::jsonb);
  perform pg_temp.assert_eq('C1 report lat', (d -> 2 ->> 'lat')::numeric, 19.05);

  d := public.my_reports('00000000-0000-4000-8000-0000000000c2');
  perform pg_temp.assert_sanitised('C2 my_reports', d);
  perform pg_temp.assert_eq('C2 only own reports',
    (select array_agg(r ->> 'id' order by r ->> 'id') from jsonb_array_elements(d) r),
    array['30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000007']);

  d := public.my_reports('00000000-0000-4000-8000-0000000000c3');
  perform pg_temp.assert_eq('C3 report follows merge to target', d -> 0 -> 'issue' ->> 'id', '10000000-0000-4000-8000-000000000001');
  perform pg_temp.assert_eq('C3 target status', d -> 0 -> 'issue' ->> 'status', 'REPORTED');
  perform pg_temp.assert_eq('C3 report category kept', d -> 0 ->> 'category', 'DRAINAGE');

  perform pg_temp.assert_eq('no reports', public.my_reports('00000000-0000-4000-8000-0000000000c9'), '[]'::jsonb);
  perform pg_temp.assert_eq('null user', public.my_reports(null), '[]'::jsonb);
end $$;

rollback;

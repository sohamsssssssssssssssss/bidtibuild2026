-- photo_object (20261002000900_photo_route.sql): GET /api/photos/:kind/:id resolves storage objects
-- through it. Kinds, REJECTED visibility (same rule as issue_detail), unknown input, privileges.
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

create function pg_temp.assert_eq(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception '%: expected % got %', p_label, p_want, p_got; end if;
end $$;

-- Privileges -------------------------------------------------------------------------------------
do $$ declare f regprocedure := 'public.photo_object(text, uuid, uuid)'; begin
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
    raise exception 'photo_object is executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', f, 'execute') then
    raise exception 'photo_object is not executable by service_role';
  end if;
  if not (select prosecdef from pg_proc where oid = f) then
    raise exception 'photo_object is not security definer';
  end if;
  if not (select 'search_path=public, extensions' = any (proconfig) from pg_proc where oid = f) then
    raise exception 'photo_object must set search_path = public, extensions';
  end if;
end $$;

set local role authenticated;
select pg_temp.expect_error($q$select public.photo_object('report', '75000000-0000-4000-8000-000000000001', null)$q$, '42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.photo_object('report', '75000000-0000-4000-8000-000000000001', null)$q$, '42501');
reset role;

-- Fixtures (superuser) ---------------------------------------------------------------------------
-- A1 authority; C1, C2, C3 reporters; C9 unrelated citizen.
-- J1 POTHOLE REPORTED (C1 + C3), J2 STREETLIGHT RESOLVED (C2 + evidence), J3 GARBAGE REJECTED (C1 + C2,
-- plus evidence so the evidence kind is covered for REJECTED too).
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'authority@test.local');
insert into public.users (id, name, email) values ('00000000-0000-4000-8000-0000000000a1', 'Test Authority', 'authority@test.local');

insert into public.issues (id, category, status, geom, resolved_at) values
  ('71000000-0000-4000-8000-000000000001', 'POTHOLE',     'REPORTED', 'SRID=4326;POINT(72.83 19.05)', null),
  ('71000000-0000-4000-8000-000000000002', 'STREETLIGHT', 'RESOLVED', 'SRID=4326;POINT(72.84 19.06)', now()),
  ('71000000-0000-4000-8000-000000000003', 'GARBAGE',     'REJECTED', 'SRID=4326;POINT(72.85 19.07)', null);

insert into public.reports (id, issue_id, reporter_user_id, category, description, image_path, geom) values
  ('75000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'POTHOLE', 'open',
   '00000000-0000-4000-8000-0000000000c1/7a000000-0000-4000-8000-000000000001.jpg', 'SRID=4326;POINT(72.83 19.05)'),
  ('75000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000c2', 'STREETLIGHT', 'resolved',
   '00000000-0000-4000-8000-0000000000c2/7a000000-0000-4000-8000-000000000002.jpg', 'SRID=4326;POINT(72.84 19.06)'),
  ('75000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c1', 'GARBAGE', 'rejected, primary',
   '00000000-0000-4000-8000-0000000000c1/7a000000-0000-4000-8000-000000000003.jpg', 'SRID=4326;POINT(72.85 19.07)'),
  ('75000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c2', 'GARBAGE', 'rejected, support',
   '00000000-0000-4000-8000-0000000000c2/7a000000-0000-4000-8000-000000000004.jpg', 'SRID=4326;POINT(72.85 19.07)'),
  ('75000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c3', 'POTHOLE', 'open, support',
   '00000000-0000-4000-8000-0000000000c3/7a000000-0000-4000-8000-000000000005.jpg', 'SRID=4326;POINT(72.83 19.05)');

insert into public.resolution_evidence (id, issue_id, uploaded_by, image_path, note) values
  ('76000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000000000a1/7e000000-0000-4000-8000-000000000001.jpg', 'fixed'),
  ('76000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000000000a1/7e000000-0000-4000-8000-000000000002.jpg', 'on a rejected issue');

-- Kinds ------------------------------------------------------------------------------------------
select pg_temp.assert_eq('report, anonymous viewer',
  public.photo_object('report', '75000000-0000-4000-8000-000000000001', null),
  '{"bucket":"report-photos","path":"00000000-0000-4000-8000-0000000000c1/7a000000-0000-4000-8000-000000000001.jpg","public":true}'::jsonb);
select pg_temp.assert_eq('report, signed-in unrelated viewer (same answer)',
  public.photo_object('report', '75000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c9'),
  public.photo_object('report', '75000000-0000-4000-8000-000000000001', null));
select pg_temp.assert_eq('report on a RESOLVED issue',
  public.photo_object('report', '75000000-0000-4000-8000-000000000002', null) ->> 'path',
  '00000000-0000-4000-8000-0000000000c2/7a000000-0000-4000-8000-000000000002.jpg');
select pg_temp.assert_eq('evidence, anonymous viewer',
  public.photo_object('evidence', '76000000-0000-4000-8000-000000000001', null),
  '{"bucket":"resolution-photos","path":"00000000-0000-4000-8000-0000000000a1/7e000000-0000-4000-8000-000000000001.jpg","public":true}'::jsonb);

-- Unknown input → null -----------------------------------------------------------------------------
select pg_temp.assert_eq('unknown kind', public.photo_object('photo', '75000000-0000-4000-8000-000000000001', null), null::jsonb);
select pg_temp.assert_eq('kind is case-sensitive', public.photo_object('REPORT', '75000000-0000-4000-8000-000000000001', null), null::jsonb);
select pg_temp.assert_eq('null kind', public.photo_object(null, '75000000-0000-4000-8000-000000000001', null), null::jsonb);
select pg_temp.assert_eq('null id', public.photo_object('report', null, null), null::jsonb);
select pg_temp.assert_eq('unknown report id', public.photo_object('report', '75000000-0000-4000-8000-0000000000ff', null), null::jsonb);
select pg_temp.assert_eq('unknown evidence id', public.photo_object('evidence', '76000000-0000-4000-8000-0000000000ff', null), null::jsonb);
select pg_temp.assert_eq('report id as evidence', public.photo_object('evidence', '75000000-0000-4000-8000-000000000001', null), null::jsonb);
select pg_temp.assert_eq('evidence id as report', public.photo_object('report', '76000000-0000-4000-8000-000000000001', null), null::jsonb);

-- REJECTED: only an authority or a viewer with a report on the issue ---------------------------------
do $$ declare
  k text; id uuid; viewer uuid;
begin
  foreach k in array array['report:75000000-0000-4000-8000-000000000003', 'report:75000000-0000-4000-8000-000000000004',
                           'evidence:76000000-0000-4000-8000-000000000002'] loop
    id := split_part(k, ':', 2)::uuid;
    k := split_part(k, ':', 1);
    perform pg_temp.assert_eq(format('rejected %s %s, anonymous', k, id), public.photo_object(k, id, null), null::jsonb);
    perform pg_temp.assert_eq(format('rejected %s %s, unrelated citizen', k, id),
      public.photo_object(k, id, '00000000-0000-4000-8000-0000000000c9'), null::jsonb);
    -- C1 and C2 both reported J3 (each may see the other's photo too, like issue_detail); A1 is an authority.
    foreach viewer in array array['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2',
                                  '00000000-0000-4000-8000-0000000000a1']::uuid[] loop
      perform pg_temp.assert_eq(format('rejected %s %s, viewer %s: public flag', k, id, viewer),
        public.photo_object(k, id, viewer) -> 'public', 'false'::jsonb);
      if public.photo_object(k, id, viewer) ->> 'path' is null then
        raise exception 'rejected % %: hidden from viewer %', k, id, viewer;
      end if;
    end loop;
  end loop;
  perform pg_temp.assert_eq('rejected report bucket',
    public.photo_object('report', '75000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000c1'),
    '{"bucket":"report-photos","path":"00000000-0000-4000-8000-0000000000c2/7a000000-0000-4000-8000-000000000004.jpg","public":false}'::jsonb);
  -- C3 reported J1 only: a report on another issue does not count.
  perform pg_temp.assert_eq('reporter of another issue is not a reporter of J3',
    public.photo_object('report', '75000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c3'), null::jsonb);
end $$;

-- photo_object agrees with issue_detail / my_reports ------------------------------------------------
-- Every photo those functions reference for a viewer is served to that viewer.
do $$ declare
  viewer uuid; issue uuid; d jsonb; p jsonb;
begin
  foreach viewer in array array[null, '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2',
                                '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000a1']::uuid[] loop
    foreach issue in array array['71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002',
                                 '71000000-0000-4000-8000-000000000003']::uuid[] loop
      d := public.issue_detail(issue, viewer);
      continue when d is null;
      for p in select * from jsonb_array_elements(d -> 'photos') loop
        if (p ->> 'has_photo')::boolean and public.photo_object('report', (p ->> 'id')::uuid, viewer) is null then
          raise exception 'issue_detail references report photo % that photo_object hides from %', p ->> 'id', viewer;
        end if;
      end loop;
      for p in select * from jsonb_array_elements(d -> 'resolution_evidence') loop
        if (p ->> 'has_photo')::boolean and public.photo_object('evidence', (p ->> 'id')::uuid, viewer) is null then
          raise exception 'issue_detail references evidence photo % that photo_object hides from %', p ->> 'id', viewer;
        end if;
      end loop;
    end loop;

    for p in select * from jsonb_array_elements(public.my_reports(viewer)) loop
      if (p ->> 'has_photo')::boolean and public.photo_object('report', (p ->> 'id')::uuid, viewer) is null then
        raise exception 'my_reports references report photo % that photo_object hides from %', p ->> 'id', viewer;
      end if;
      if (p -> 'issue' -> 'latest_resolution_evidence' ->> 'has_photo')::boolean
         and public.photo_object('evidence', (p -> 'issue' -> 'latest_resolution_evidence' ->> 'id')::uuid, viewer) is null then
        raise exception 'my_reports references evidence photo % that photo_object hides from %',
          p -> 'issue' -> 'latest_resolution_evidence' ->> 'id', viewer;
      end if;
    end loop;
  end loop;

  -- C1's my_reports includes the REJECTED issue, with its own photo referenced.
  perform pg_temp.assert_eq('C1 my_reports covers the rejected report',
    (select (r ->> 'has_photo')::boolean from jsonb_array_elements(public.my_reports('00000000-0000-4000-8000-0000000000c1')) r
     where r ->> 'id' = '75000000-0000-4000-8000-000000000003'), true);
  -- C2's latest evidence on the REJECTED issue is referenced and served.
  perform pg_temp.assert_eq('C2 my_reports: rejected issue evidence',
    (select r -> 'issue' -> 'latest_resolution_evidence' ->> 'id' from jsonb_array_elements(public.my_reports('00000000-0000-4000-8000-0000000000c2')) r
     where r ->> 'id' = '75000000-0000-4000-8000-000000000004'), '76000000-0000-4000-8000-000000000002');
end $$;

rollback;

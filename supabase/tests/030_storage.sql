-- Storage tests (02 §10.2): bucket settings and storage.objects policies.
-- Both buckets are private (photos are served by GET /api/photos/:kind/:id); uploaders can read
-- their own folder only.
-- Runs in one transaction that is rolled back.
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

-- Buckets -------------------------------------------------------------------------------------------
do $$ declare b record; n int := 0; begin
  for b in select * from storage.buckets where id in ('report-photos', 'resolution-photos') loop
    n := n + 1;
    if b.name <> b.id or b.public or b.file_size_limit <> 2097152 or b.allowed_mime_types <> array['image/jpeg'] then
      raise exception 'bucket % misconfigured: %', b.id, row_to_json(b);
    end if;
  end loop;
  if n <> 2 then raise exception 'expected 2 buckets, found %', n; end if;

  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and cmd in ('UPDATE', 'DELETE', 'ALL')) then
    raise exception 'storage.objects must have no update/delete policies';
  end if;

  -- SELECT policies: exactly the two own-folder ones, for authenticated only (no public read).
  if (select array_agg(policyname::text order by policyname) from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT')
     is distinct from array['report-photos: read own folder', 'resolution-photos: read own folder'] then
    raise exception 'unexpected storage.objects SELECT policies: %',
      (select array_agg(policyname) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT');
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and cmd = 'SELECT' and roles <> array['authenticated']::name[]) then
    raise exception 'storage.objects SELECT policies must be for authenticated only';
  end if;
end $$;

-- Fixtures: A1 is an authority.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'authority@test.local');
insert into public.users (id, name, email) values ('00000000-0000-4000-8000-0000000000a1', 'Test Authority', 'authority@test.local');

-- Citizen C1 -------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';

-- own folder in report-photos: allowed, and the row can be read back (INSERT ... RETURNING)
do $$ declare got text; begin
  insert into storage.objects (bucket_id, name)
    values ('report-photos', '00000000-0000-4000-8000-0000000000c1/aaaa.jpg')
    returning name into got;
  if got is null then raise exception 'own-folder upload returned nothing'; end if;
end $$;
-- another user's folder / root / resolution-photos: denied
select pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('report-photos', '00000000-0000-4000-8000-0000000000c2/bbbb.jpg')$q$, '42501', '%row-level security%');
select pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('report-photos', 'cccc.jpg')$q$, '42501', '%row-level security%');
select pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('resolution-photos', '00000000-0000-4000-8000-0000000000c1/dddd.jpg')$q$, '42501', '%row-level security%');
-- C1 reads its own folder only (the other objects are inserted below as superuser)
reset role;
insert into storage.objects (bucket_id, name) values
  ('report-photos', '00000000-0000-4000-8000-0000000000c2/c2-photo.jpg'),
  ('resolution-photos', '00000000-0000-4000-8000-0000000000a1/a1-evidence.jpg');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
do $$ declare names text[]; begin
  select array_agg(name order by name) into names from storage.objects
  where bucket_id in ('report-photos', 'resolution-photos');
  if names is distinct from array['00000000-0000-4000-8000-0000000000c1/aaaa.jpg'] then
    raise exception 'citizen should see only its own folder, saw %', names;
  end if;
end $$;
-- no update/delete of objects, even own
do $$ declare n int; begin
  update storage.objects set name = name where bucket_id = 'report-photos';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'citizen could update a storage object'; end if;
  delete from storage.objects where bucket_id = 'report-photos';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'citizen could delete a storage object'; end if;
end $$;
reset role;

-- anon cannot upload ------------------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('report-photos', 'eeee.jpg')$q$, '42501', '%row-level security%');
-- no public read: anon sees no photo objects at all
do $$ begin
  if exists (select 1 from storage.objects where bucket_id in ('report-photos', 'resolution-photos')) then
    raise exception 'anon can read photo objects (buckets must be private)';
  end if;
end $$;
reset role;

-- Authority A1 ---------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
do $$ declare got text; begin
  insert into storage.objects (bucket_id, name)
    values ('resolution-photos', '00000000-0000-4000-8000-0000000000a1/ffff.jpg')
    returning name into got;
  if got is null then raise exception 'authority upload returned nothing'; end if;
end $$;
select pg_temp.expect_error($q$insert into storage.objects (bucket_id, name) values ('resolution-photos', '00000000-0000-4000-8000-0000000000c1/gggg.jpg')$q$, '42501', '%row-level security%');
-- the authority reads its own folder too, but not citizens' photos (served by the API instead)
do $$ declare names text[]; begin
  select array_agg(name order by name) into names from storage.objects
  where bucket_id in ('report-photos', 'resolution-photos');
  if names is distinct from array['00000000-0000-4000-8000-0000000000a1/a1-evidence.jpg', '00000000-0000-4000-8000-0000000000a1/ffff.jpg'] then
    raise exception 'authority should see only its own folder, saw %', names;
  end if;
end $$;
reset role;

rollback;

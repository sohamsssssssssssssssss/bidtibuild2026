-- Storage tests (02 §10.2): bucket settings and storage.objects policies.
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
    if b.name <> b.id or not b.public or b.file_size_limit <> 2097152 or b.allowed_mime_types <> array['image/jpeg'] then
      raise exception 'bucket % misconfigured: %', b.id, row_to_json(b);
    end if;
  end loop;
  if n <> 2 then raise exception 'expected 2 buckets, found %', n; end if;

  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and cmd in ('UPDATE', 'DELETE', 'ALL')) then
    raise exception 'storage.objects must have no update/delete policies';
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
do $$ begin
  if not exists (select 1 from storage.objects where name = '00000000-0000-4000-8000-0000000000c1/aaaa.jpg') then
    raise exception 'public read of report-photos failed';
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
reset role;

rollback;

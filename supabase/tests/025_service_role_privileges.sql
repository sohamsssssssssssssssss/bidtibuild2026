-- Phase 0 Data API grants. Runs after migrations in a rolled-back transaction.
begin;

create function pg_temp.expect_denied(p_sql text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'expected permission denial: %', p_sql;
end $$;
grant execute on function pg_temp.expect_denied(text) to public;

do $$ begin
  if not has_schema_privilege('service_role', 'public', 'usage') then
    raise exception 'service_role lacks public schema usage';
  end if;
  if not (has_table_privilege('service_role', 'public.users', 'select')
          and has_table_privilege('service_role', 'public.users', 'insert')
          and has_table_privilege('service_role', 'public.users', 'update')) then
    raise exception 'service_role cannot upsert/read public.users';
  end if;
  if not (has_table_privilege('service_role', 'public.issues', 'select')
          and has_table_privilege('service_role', 'public.hotspots', 'select')) then
    raise exception 'service_role cannot count issues/hotspots';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'S') then
    raise exception 'public now has sequences; review service_role sequence grants';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'insert')
        or has_table_privilege('anon', c.oid, 'update')
        or has_table_privilege('anon', c.oid, 'delete')
        or has_table_privilege('anon', c.oid, 'truncate')
        or has_table_privilege('authenticated', c.oid, 'insert')
        or has_table_privilege('authenticated', c.oid, 'update')
        or has_table_privilege('authenticated', c.oid, 'delete')
        or has_table_privilege('authenticated', c.oid, 'truncate'))
  ) then
    raise exception 'anon/authenticated gained direct table writes';
  end if;
end $$;

-- A matching Auth user must exist before public.users can be inserted.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000f1', 'service-grant-test@test.local');

set local role service_role;
select count(*) from public.users;
insert into public.users (id, name, email)
values ('00000000-0000-4000-8000-0000000000f1', 'Grant test', 'service-grant-test@test.local');
update public.users set name = 'Updated grant test'
where id = '00000000-0000-4000-8000-0000000000f1';
do $$ begin
  if (select name from public.users where id = '00000000-0000-4000-8000-0000000000f1') <> 'Updated grant test' then
    raise exception 'service_role users update was not visible';
  end if;
end $$;
select count(*) from public.issues;
select count(*) from public.hotspots;
select pg_temp.expect_denied($q$delete from public.users where id = '00000000-0000-4000-8000-0000000000f1'$q$);
select pg_temp.expect_denied($q$update public.issues set category = 'POTHOLE' where false$q$);
select pg_temp.expect_denied($q$update public.issue_events set note = 'tampered' where false$q$);
select pg_temp.expect_denied($q$delete from public.issue_events where false$q$);
select pg_temp.expect_denied($q$truncate public.issue_events$q$);
reset role;

set local role anon;
select pg_temp.expect_denied($q$insert into public.users (id, name, email) values ('00000000-0000-4000-8000-0000000000f1', 'bad', 'bad')$q$);
select pg_temp.expect_denied($q$update public.users set name = 'bad' where false$q$);
reset role;

set local role authenticated;
select pg_temp.expect_denied($q$insert into public.users (id, name, email) values ('00000000-0000-4000-8000-0000000000f1', 'bad', 'bad')$q$);
select pg_temp.expect_denied($q$update public.users set name = 'bad' where false$q$);
reset role;

rollback;

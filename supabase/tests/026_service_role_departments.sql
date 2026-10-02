-- GET /api/departments needs service_role SELECT on departments (migration 20261002063300).
begin;
do $$ begin
  if not has_table_privilege('service_role', 'public.departments', 'select') then
    raise exception 'service_role cannot SELECT public.departments (GET /api/departments would fail)';
  end if;
end $$;
set local role service_role;
select count(*) from public.departments;
reset role;
rollback;

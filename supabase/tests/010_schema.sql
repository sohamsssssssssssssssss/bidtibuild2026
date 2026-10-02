-- Schema tests: enums, check constraints, updated_at trigger, append-only issue_events,
-- is_authority, function privilege defaults, indexes (04 §1–§5).
-- Everything runs in one transaction that is rolled back, so the DB is left untouched.
begin;

-- expect_error(sql, sqlstate, message pattern): runs sql as the current role and fails unless it
-- raises that SQLSTATE (and, if given, a message matching the LIKE pattern).
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

-- Enums ----------------------------------------------------------------------------------------
do $$ begin
  if enum_range(null::public.issue_category)::text[] <> array['POTHOLE','STREETLIGHT','GARBAGE','WATER_LEAK','DRAINAGE','WATERLOGGING','FOOTPATH','PUBLIC_PROPERTY','OTHER'] then
    raise exception 'issue_category values wrong: %', enum_range(null::public.issue_category);
  end if;
  if enum_range(null::public.issue_status)::text[] <> array['REPORTED','ASSIGNED','IN_PROGRESS','RESOLVED','REJECTED','MERGED','REOPENED'] then
    raise exception 'issue_status values wrong: %', enum_range(null::public.issue_status);
  end if;
  if enum_range(null::public.level)::text[] <> array['LOW','MEDIUM','HIGH','CRITICAL'] then
    raise exception 'level values wrong';
  end if;
  if enum_range(null::public.user_role)::text[] <> array['AUTHORITY'] then
    raise exception 'user_role values wrong';
  end if;
end $$;

-- Fixtures (superuser) ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'authority@test.local');
insert into public.users (id, name, email) values ('00000000-0000-4000-8000-0000000000a1', 'Test Authority', 'authority@test.local');
insert into public.departments (id, name, sla_hours, default_categories)
  values ('00000000-0000-4000-8000-0000000000d1', 'Test Roads', 72, '{POTHOLE}');
insert into public.issues (id, category, geom, updated_at)
  values ('10000000-0000-4000-8000-000000000001', 'POTHOLE', 'SRID=4326;POINT(72.83 19.05)', now() - interval '1 day');
insert into public.issue_events (id, issue_id, event_type, to_status)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'CREATED', 'REPORTED');

-- Defaults
do $$ declare r record; begin
  select * into r from public.issues where id = '10000000-0000-4000-8000-000000000001';
  if r.status <> 'REPORTED' or r.is_seed then raise exception 'issues defaults wrong'; end if;
  if (select role from public.users where id = '00000000-0000-4000-8000-0000000000a1') <> 'AUTHORITY' then
    raise exception 'users.role default wrong';
  end if;
  if (select metadata from public.issue_events where id = '20000000-0000-4000-8000-000000000001') <> '{}'::jsonb then
    raise exception 'issue_events.metadata default wrong';
  end if;
end $$;

-- issues check constraints -------------------------------------------------------------------------
select pg_temp.expect_error($q$insert into public.issues (category, status, geom) values ('POTHOLE', 'MERGED', 'SRID=4326;POINT(72.83 19.05)')$q$,
  '23514', '%issues_merged_consistency_chk%');
select pg_temp.expect_error($q$insert into public.issues (category, status, geom, merged_into_issue_id) values ('POTHOLE', 'REPORTED', 'SRID=4326;POINT(72.83 19.05)', '10000000-0000-4000-8000-000000000001')$q$,
  '23514', '%issues_merged_consistency_chk%');
select pg_temp.expect_error($q$insert into public.issues (id, category, status, geom, merged_into_issue_id) values ('10000000-0000-4000-8000-0000000000ff', 'POTHOLE', 'MERGED', 'SRID=4326;POINT(72.83 19.05)', '10000000-0000-4000-8000-0000000000ff')$q$,
  '23514', '%issues_not_self_merged_chk%');
select pg_temp.expect_error($q$update public.issues set status = 'MERGED', merged_into_issue_id = id where id = '10000000-0000-4000-8000-000000000001'$q$,
  '23514', '%issues_not_self_merged_chk%');
select pg_temp.expect_error($q$insert into public.issues (category, status, geom) values ('POTHOLE', 'ASSIGNED', 'SRID=4326;POINT(72.83 19.05)')$q$,
  '23514', '%issues_assigned_has_department_chk%');
select pg_temp.expect_error($q$insert into public.issues (category, status, geom) values ('POTHOLE', 'IN_PROGRESS', 'SRID=4326;POINT(72.83 19.05)')$q$,
  '23514', '%issues_assigned_has_department_chk%');
select pg_temp.expect_error($q$insert into public.issues (category, status, geom, assigned_department_id) values ('POTHOLE', 'RESOLVED', 'SRID=4326;POINT(72.83 19.05)', '00000000-0000-4000-8000-0000000000d1')$q$,
  '23514', '%issues_resolved_has_resolved_at_chk%');
-- valid counterparts are accepted
insert into public.issues (category, status, geom, assigned_department_id)
  values ('POTHOLE', 'ASSIGNED', 'SRID=4326;POINT(72.83 19.05)', '00000000-0000-4000-8000-0000000000d1'),
         ('POTHOLE', 'IN_PROGRESS', 'SRID=4326;POINT(72.83 19.05)', '00000000-0000-4000-8000-0000000000d1');
insert into public.issues (category, status, geom, resolved_at) values ('POTHOLE', 'RESOLVED', 'SRID=4326;POINT(72.83 19.05)', now());
insert into public.issues (category, status, geom, merged_into_issue_id)
  values ('POTHOLE', 'MERGED', 'SRID=4326;POINT(72.83 19.05)', '10000000-0000-4000-8000-000000000001');

-- other checks
select pg_temp.expect_error($q$insert into public.issue_events (issue_id, event_type) values ('10000000-0000-4000-8000-000000000001', 'DELETED')$q$,
  '23514', '%issue_events_event_type_chk%');
select pg_temp.expect_error($q$insert into public.risk_zones (name, risk_value, geom) values ('bad', 101, 'SRID=4326;POLYGON((72.8 19.0,72.9 19.0,72.9 19.1,72.8 19.0))')$q$,
  '23514');
select pg_temp.expect_error($q$insert into public.issues (category, geom) values ('POTHOLE', 'SRID=4326;POLYGON((72.8 19.0,72.9 19.0,72.9 19.1,72.8 19.0))')$q$,
  '22023'); -- geography(Point) rejects a polygon
-- every allowed event_type is accepted
insert into public.issue_events (issue_id, event_type)
select '10000000-0000-4000-8000-000000000001', t
from unnest(array['CREATED','SUPPORT_ADDED','SEVERITY_CONFIRMED','PRIORITY_SET','ASSIGNED','REASSIGNED',
                  'STATUS_CHANGED','RESOLVED','REJECTED','MERGED_INTO','MERGED_FROM','REOPENED']) t;

-- updated_at touch trigger ---------------------------------------------------------------------------
update public.issues set final_priority = 'HIGH' where id = '10000000-0000-4000-8000-000000000001';
do $$ begin
  if (select updated_at from public.issues where id = '10000000-0000-4000-8000-000000000001') <> now() then
    raise exception 'issues.updated_at was not touched on update';
  end if;
end $$;

-- issue_events is append-only, for superuser and service_role alike ------------------------------------
do $$ begin
  if not current_setting('is_superuser')::boolean then raise exception 'test must start as superuser'; end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.issue_events'::regclass
             and tgname in ('issue_events_append_only', 'issue_events_no_truncate') and tgenabled <> 'O') then
    raise exception 'append-only trigger is not enabled';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.issue_events'::regclass
      and tgname in ('issue_events_append_only', 'issue_events_no_truncate')) <> 2 then
    raise exception 'append-only triggers missing';
  end if;
end $$;
select pg_temp.expect_error($q$update public.issue_events set note = 'x'$q$, 'P0001', '%append-only%UPDATE%');
select pg_temp.expect_error($q$delete from public.issue_events$q$, 'P0001', '%append-only%DELETE%');
select pg_temp.expect_error($q$truncate public.issue_events$q$, 'P0001', '%append-only%TRUNCATE%');
select pg_temp.expect_error($q$truncate public.issues cascade$q$, 'P0001', '%append-only%TRUNCATE%');

-- Give service_role full audit-table privileges *inside this rolled-back test* so
-- these failures prove the triggers still block mutations even if grants change.
grant select, insert, update, delete, truncate on public.issue_events to service_role;
set local role service_role;
select pg_temp.expect_error($q$update public.issue_events set note = 'x'$q$, 'P0001', '%append-only%UPDATE%');
select pg_temp.expect_error($q$delete from public.issue_events where id = '20000000-0000-4000-8000-000000000001'$q$, 'P0001', '%append-only%DELETE%');
select pg_temp.expect_error($q$truncate public.issue_events$q$, 'P0001', '%append-only%TRUNCATE%');
-- service_role can still append
insert into public.issue_events (issue_id, event_type, note) values ('10000000-0000-4000-8000-000000000001', 'STATUS_CHANGED', 'by service_role');
reset role;
revoke select, insert, update, delete, truncate on public.issue_events from service_role;

do $$ begin
  if (select count(*) from public.issue_events where id = '20000000-0000-4000-8000-000000000001' and note is null) <> 1 then
    raise exception 'issue_events row was modified';
  end if;
end $$;

-- is_authority ---------------------------------------------------------------------------------------
do $$ begin
  if not public.is_authority('00000000-0000-4000-8000-0000000000a1') then raise exception 'is_authority(authority) should be true'; end if;
  if public.is_authority('00000000-0000-4000-8000-0000000000c1') then raise exception 'is_authority(citizen) should be false'; end if;
  if public.is_authority(gen_random_uuid()) then raise exception 'is_authority(random) should be false'; end if;
  if public.is_authority(null) is distinct from false then raise exception 'is_authority(null) should be false'; end if;

  if not (select prosecdef from pg_proc where oid = 'public.is_authority(uuid)'::regprocedure) then
    raise exception 'is_authority must be SECURITY DEFINER';
  end if;
  if (select proconfig from pg_proc where oid = 'public.is_authority(uuid)'::regprocedure) <> array['search_path=public, extensions'] then
    raise exception 'is_authority search_path wrong: %', (select proconfig from pg_proc where oid = 'public.is_authority(uuid)'::regprocedure);
  end if;
  if not (has_function_privilege('anon', 'public.is_authority(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.is_authority(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.is_authority(uuid)', 'execute')) then
    raise exception 'is_authority must be executable by anon, authenticated and service_role';
  end if;
end $$;

-- is_authority works as a non-privileged role (it reads users via SECURITY DEFINER)
set local role anon;
do $$ begin
  if not public.is_authority('00000000-0000-4000-8000-0000000000a1') then raise exception 'is_authority as anon should be true'; end if;
end $$;
reset role;

-- Function privilege defaults: new public functions are service_role-only ----------------------------
create function public.zz_probe_write_fn() returns int language sql as 'select 1';
do $$ declare f text; begin
  foreach f in array array['public.zz_probe_write_fn()', 'public.touch_updated_at()', 'public.issue_events_append_only()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% must not be executable by anon/authenticated', f;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f::regprocedure and a.grantee = 0) then
      raise exception '% must not be executable by PUBLIC', f;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.zz_probe_write_fn()', 'execute') then
    raise exception 'new public functions should default to service_role execute';
  end if;
end $$;

-- Indexes (04 §5) --------------------------------------------------------------------------------------
do $$ declare missing text[]; begin
  select array_agg(x) into missing from unnest(array[
    'issues_geom_gix', 'reports_geom_gix', 'risk_zones_geom_gix', 'hotspots_geom_gix',
    'issues_status_category_created_at_idx', 'issues_merged_into_issue_id_idx',
    'reports_issue_id_created_at_idx', 'reports_reporter_user_id_created_at_idx',
    'reports_reporter_ip_hash_created_at_idx', 'issue_events_issue_id_created_at_idx',
    'hotspots_active_generated_at_idx'
  ]) x where not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = x);
  if missing is not null then raise exception 'missing indexes: %', missing; end if;
  if (select count(*) from pg_indexes where schemaname = 'public' and indexname like '%_geom_gix' and indexdef ilike '%using gist%') <> 4 then
    raise exception 'geom indexes must be GiST';
  end if;
end $$;

rollback;

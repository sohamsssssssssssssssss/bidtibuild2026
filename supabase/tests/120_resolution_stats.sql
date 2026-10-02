-- resolution_stats (GET /api/stats/resolution): shape, numbers against an independent query, the
-- change our fixtures cause, the window, demo counts, config errors and privileges.
-- Works with and without the seed: it compares before/after and recomputes from the table.
begin;

create function pg_temp.cfg(p_days int default 90) returns jsonb language sql as $$
  select jsonb_build_object('window_days', p_days, 'open_statuses', '["REPORTED","ASSIGNED","IN_PROGRESS"]'::jsonb)
$$;

create function pg_temp.row_of(p_stats jsonb, p_category text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p_stats -> 'categories') e where e ->> 'category' = p_category
$$;

-- Independent reference: the same numbers computed straight from the table.
create function pg_temp.reference(p_days int) returns table (
  category text, resolved_count bigint, avg_h numeric, median_h numeric, demo bigint, open_count bigint
) language sql as $$
  select c::text,
         (select count(*) from public.issues i where i.category = c and i.status = 'RESOLVED'
            and i.resolved_at > now() - make_interval(days => p_days)),
         (select round(avg(extract(epoch from i.resolved_at - i.created_at) / 3600)::numeric, 1)
            from public.issues i where i.category = c and i.status = 'RESOLVED'
            and i.resolved_at > now() - make_interval(days => p_days)),
         (select round((percentile_cont(0.5) within group (order by extract(epoch from i.resolved_at - i.created_at) / 3600))::numeric, 1)
            from public.issues i where i.category = c and i.status = 'RESOLVED'
            and i.resolved_at > now() - make_interval(days => p_days)),
         (select count(*) from public.issues i where i.category = c and i.status = 'RESOLVED' and i.is_seed
            and i.resolved_at > now() - make_interval(days => p_days)),
         (select count(*) from public.issues i where i.category = c and i.status in ('REPORTED','ASSIGNED','IN_PROGRESS'))
  from unnest(enum_range(null::public.issue_category)) c
$$;

create function pg_temp.assert_matches_reference(p_days int) returns void language plpgsql as $$
declare
  s jsonb := public.resolution_stats(pg_temp.cfg(p_days));
  r record;
  e jsonb;
begin
  if (s ->> 'window_days')::int <> p_days then raise exception 'window_days echoed wrong: %', s ->> 'window_days'; end if;
  if jsonb_array_length(s -> 'categories') <> 9 then raise exception 'expected 9 categories, got %', jsonb_array_length(s -> 'categories'); end if;
  if (select array_agg(e2 ->> 'category' order by o) from jsonb_array_elements(s -> 'categories') with ordinality x(e2, o))
     <> (select array_agg(c::text order by c) from unnest(enum_range(null::public.issue_category)) c) then
    raise exception 'categories not in enum order';
  end if;
  for r in select * from pg_temp.reference(p_days) loop
    e := pg_temp.row_of(s, r.category);
    if (e ->> 'resolved_count')::bigint <> r.resolved_count
       or (e ->> 'avg_resolution_hours')::numeric is distinct from r.avg_h
       or (e ->> 'median_resolution_hours')::numeric is distinct from r.median_h
       or (e ->> 'demo_resolved_count')::bigint <> r.demo
       or (e ->> 'open_count')::bigint <> r.open_count then
      raise exception 'window % / %: got %, reference %', p_days, r.category, e, row_to_json(r);
    end if;
  end loop;
  if s::text ~* 'reporter|actor|[0-9a-f]{8}-[0-9a-f]{4}-' then
    raise exception 'output must carry counts only, no ids: %', s;
  end if;
end $$;

-- Before fixtures (whatever the seed holds).
select pg_temp.assert_matches_reference(90);

create temp table before_stats as select public.resolution_stats(pg_temp.cfg(90)) as s;

-- Fixtures, all STREETLIGHT, far from seed data. Two resolved in the window (4 h and 20 h), one resolved
-- 100 days ago (outside 90), one open, one rejected (counts nowhere).
insert into public.issues (id, category, status, geom, created_at, resolved_at) values
  ('12000000-0000-4000-8000-000000000001', 'STREETLIGHT', 'RESOLVED', 'SRID=4326;POINT(72.99 19.25)', now() - interval '10 hours', now() - interval '6 hours'),
  ('12000000-0000-4000-8000-000000000002', 'STREETLIGHT', 'RESOLVED', 'SRID=4326;POINT(72.99 19.25)', now() - interval '30 hours', now() - interval '10 hours'),
  ('12000000-0000-4000-8000-000000000003', 'STREETLIGHT', 'RESOLVED', 'SRID=4326;POINT(72.99 19.25)', now() - interval '101 days', now() - interval '100 days'),
  ('12000000-0000-4000-8000-000000000004', 'STREETLIGHT', 'REPORTED', 'SRID=4326;POINT(72.99 19.25)', now() - interval '2 hours', null),
  ('12000000-0000-4000-8000-000000000005', 'STREETLIGHT', 'REJECTED', 'SRID=4326;POINT(72.99 19.25)', now() - interval '3 hours', null);

select pg_temp.assert_matches_reference(90);
select pg_temp.assert_matches_reference(1);
select pg_temp.assert_matches_reference(365);

do $$
declare
  b jsonb := pg_temp.row_of((select s from before_stats), 'STREETLIGHT');
  a jsonb := pg_temp.row_of(public.resolution_stats(pg_temp.cfg(90)), 'STREETLIGHT');
  n0 int := (b ->> 'resolved_count')::int;
  expected_avg numeric;
begin
  if (a ->> 'resolved_count')::int <> n0 + 2 then raise exception 'resolved_count should grow by 2: % → %', b, a; end if;
  if (a ->> 'open_count')::int <> (b ->> 'open_count')::int + 1 then raise exception 'open_count should grow by 1: % → %', b, a; end if;
  if (a ->> 'demo_resolved_count')::int <> (b ->> 'demo_resolved_count')::int then raise exception 'fixtures are not demo data'; end if;
  if n0 = 0 then
    if (a ->> 'avg_resolution_hours')::numeric <> 12.0 or (a ->> 'median_resolution_hours')::numeric <> 12.0 then
      raise exception 'avg/median of 4 h and 20 h should be 12.0: %', a;
    end if;
  else
    -- The rounded "before" average is within 0.05 h of the true one.
    expected_avg := ((b ->> 'avg_resolution_hours')::numeric * n0 + 24) / (n0 + 2);
    if abs((a ->> 'avg_resolution_hours')::numeric - expected_avg) > 0.1 then
      raise exception 'avg should be about %: %', round(expected_avg, 2), a;
    end if;
  end if;
end $$;

-- A category with nothing resolved reports nulls, not zeros.
do $$
declare e jsonb;
begin
  for e in select x from jsonb_array_elements(public.resolution_stats(pg_temp.cfg(90)) -> 'categories') x loop
    if (e ->> 'resolved_count')::int = 0
       and (jsonb_typeof(e -> 'avg_resolution_hours') <> 'null' or jsonb_typeof(e -> 'median_resolution_hours') <> 'null') then
      raise exception 'no resolutions should give null averages: %', e;
    end if;
  end loop;
end $$;

-- Config errors are programming errors (22023 → INTERNAL).
do $$
begin
  begin perform public.resolution_stats('{}'); raise exception 'missing keys accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.resolution_stats(jsonb_build_object('window_days', 0, 'open_statuses', '[]'::jsonb)); raise exception 'window 0 accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.resolution_stats(null); raise exception 'null config accepted';
  exception when sqlstate '22023' then null; end;
end $$;

-- Only the service role may run it.
do $$
begin
  if has_function_privilege('anon', 'public.resolution_stats(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.resolution_stats(jsonb)', 'execute') then
    raise exception 'anon/authenticated must not execute resolution_stats';
  end if;
  if not has_function_privilege('service_role', 'public.resolution_stats(jsonb)', 'execute') then
    raise exception 'service_role must execute resolution_stats';
  end if;
end $$;

rollback;

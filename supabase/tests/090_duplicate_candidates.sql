-- duplicate_candidates + category_family_mates (20261002001100_duplicates_merge.sql; 02 §3.2–3.5).
-- Own fixtures around lat 18.90–18.97, lng 72.95 (~13 km from every seed point), issues
-- 10000000-0000-4000-8000-0000000009NN; every cluster is ≥ 1 km from the next, so a query only
-- sees its own cluster. Points are placed with ST_Project on geography, so distances are exact metres.
-- One transaction, rolled back. now() is fixed for the whole transaction.
--
--   cluster  base (lat, lng)   purpose
--   B1       18.900, 72.950    per-category radius (just inside / just outside)
--   B2       18.910, 72.950    radius of the NEW report's category (WATER_LEAK issue 120 m away)
--   B3       18.920, 72.950    same, reversed (WATERLOGGING issue 120 m away)
--   B4       18.930, 72.950    families (DRAINAGE / WATERLOGGING / WATER_LEAK; POTHOLE vs GARBAGE)
--   B5       18.940, 72.950    ranking + max_candidates
--   B6       18.950, 72.950    status / window exclusions
--   B7       18.960, 72.950    element shape
begin;

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

-- A point p_dist metres from (p_lat, p_lng) at bearing p_az degrees.
create function pg_temp.pt(p_lat float8, p_lng float8, p_dist float8, p_az float8 default 0)
returns geography language sql as $$
  select st_project(st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_dist, radians(p_az))
$$;
grant execute on function pg_temp.pt(float8, float8, float8, float8) to public;

-- DUPLICATE_CONFIG (src/config/civic.ts), with overridable window / cap / statuses / radii / families.
create function pg_temp.dcfg(
  p_window_days int default 30,
  p_max int default 5,
  p_statuses jsonb default '["REPORTED", "ASSIGNED", "IN_PROGRESS"]',
  p_radii jsonb default '{"STREETLIGHT": 30, "POTHOLE": 50, "FOOTPATH": 50, "PUBLIC_PROPERTY": 50, "OTHER": 50,
                          "GARBAGE": 75, "WATER_LEAK": 75, "DRAINAGE": 150, "WATERLOGGING": 150}',
  p_families jsonb default '[["DRAINAGE", "WATERLOGGING", "WATER_LEAK"]]'
) returns jsonb language sql as $$
  select jsonb_build_object('radius_m_by_category', p_radii, 'window_days', p_window_days,
                            'candidate_statuses', p_statuses, 'compatible_families', p_families,
                            'max_candidates', p_max)
$$;
grant execute on function pg_temp.dcfg(int, int, jsonb, jsonb, jsonb) to public;

-- Candidate ids, in returned order (the last 2 hex digits of each fixture id, e.g. '{11,12}').
create function pg_temp.ids(p jsonb) returns text[] language sql as $$
  select coalesce(array_agg(right(e ->> 'id', 2) order by n), '{}')
  from jsonb_array_elements(p) with ordinality t(e, n)
$$;
grant execute on function pg_temp.ids(jsonb) to public;

create function pg_temp.dc(p_lat float8, p_category public.issue_category, p_config jsonb default null)
returns jsonb language sql as $$
  select public.duplicate_candidates(p_lat, 72.95, p_category, coalesce(p_config, pg_temp.dcfg()))
$$;
grant execute on function pg_temp.dc(float8, public.issue_category, jsonb) to public;

-- Privileges -------------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'public.duplicate_candidates(double precision, double precision, public.issue_category, jsonb)',
    'public.category_family_mates(public.issue_category, jsonb)'
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
  perform pg_temp.assert_eq('duplicate_candidates is stable',
    (select provolatile from pg_proc
     where oid = 'public.duplicate_candidates(double precision, double precision, public.issue_category, jsonb)'::regprocedure),
    's'::"char");
end $$;

set local role authenticated;
select pg_temp.expect_error($q$select public.duplicate_candidates(18.9, 72.95, 'POTHOLE', pg_temp.dcfg())$q$, '42501');
reset role;
set local role anon;
select pg_temp.expect_error($q$select public.duplicate_candidates(18.9, 72.95, 'POTHOLE', pg_temp.dcfg())$q$, '42501');
reset role;

-- Fixtures (superuser) ---------------------------------------------------------------------------
insert into public.departments (id, name, sla_hours) values
  ('d0000000-0000-4000-8000-000000000901', 'Test 090 Dept', 72);

insert into public.issues (id, category, status, geom, created_at) values
  -- B1: per-category radius; inside = radius - 0.5 m, outside = radius + 0.5 m
  ('10000000-0000-4000-8000-000000000911', 'STREETLIGHT', 'REPORTED', pg_temp.pt(18.90, 72.95,  29.5,   0), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000912', 'STREETLIGHT', 'REPORTED', pg_temp.pt(18.90, 72.95,  30.5, 180), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000913', 'POTHOLE',     'REPORTED', pg_temp.pt(18.90, 72.95,  49.5,  90), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000914', 'POTHOLE',     'REPORTED', pg_temp.pt(18.90, 72.95,  50.5, 270), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000915', 'GARBAGE',     'REPORTED', pg_temp.pt(18.90, 72.95,  74.5,  45), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000916', 'GARBAGE',     'REPORTED', pg_temp.pt(18.90, 72.95,  75.5, 225), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000917', 'DRAINAGE',    'REPORTED', pg_temp.pt(18.90, 72.95, 149.5, 135), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000918', 'DRAINAGE',    'REPORTED', pg_temp.pt(18.90, 72.95, 150.5, 315), now() - interval '1 hour'),
  -- B2 / B3: radius of the NEW report's category
  ('10000000-0000-4000-8000-000000000921', 'WATER_LEAK',   'REPORTED', pg_temp.pt(18.91, 72.95, 120, 0), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000931', 'WATERLOGGING', 'REPORTED', pg_temp.pt(18.92, 72.95, 120, 0), now() - interval '1 hour'),
  -- B4: families
  ('10000000-0000-4000-8000-000000000941', 'DRAINAGE',     'REPORTED', pg_temp.pt(18.93, 72.95, 10,   0), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000942', 'WATERLOGGING', 'REPORTED', pg_temp.pt(18.93, 72.95, 20,  90), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000943', 'WATER_LEAK',   'REPORTED', pg_temp.pt(18.93, 72.95, 30, 180), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000944', 'POTHOLE',      'REPORTED', pg_temp.pt(18.93, 72.95,  5, 270), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000945', 'GARBAGE',      'REPORTED', pg_temp.pt(18.93, 72.95,  6,  45), now() - interval '1 hour'),
  -- B5: ranking (query DRAINAGE, 150 m). 53 and 52 share one point; 53 is newer.
  ('10000000-0000-4000-8000-000000000951', 'DRAINAGE',     'REPORTED', pg_temp.pt(18.94, 72.95, 100,   0), now() - interval '1 day'),
  ('10000000-0000-4000-8000-000000000952', 'DRAINAGE',     'REPORTED', pg_temp.pt(18.94, 72.95,  40,  90), now() - interval '2 days'),
  ('10000000-0000-4000-8000-000000000953', 'DRAINAGE',     'REPORTED', pg_temp.pt(18.94, 72.95,  40,  90), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000954', 'WATERLOGGING', 'REPORTED', pg_temp.pt(18.94, 72.95,   5, 180), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000955', 'WATER_LEAK',   'REPORTED', pg_temp.pt(18.94, 72.95,  60, 270), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000956', 'WATERLOGGING', 'REPORTED', pg_temp.pt(18.94, 72.95, 120,  45), now() - interval '1 hour'),
  -- B6: exclusions (query POTHOLE); all at 10 m
  ('10000000-0000-4000-8000-000000000961', 'POTHOLE', 'REPORTED', pg_temp.pt(18.95, 72.95, 10, 0), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000966', 'POTHOLE', 'REJECTED', pg_temp.pt(18.95, 72.95, 10, 0), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000968', 'POTHOLE', 'REPORTED', pg_temp.pt(18.95, 72.95, 10, 0), now() - interval '29 days'),
  ('10000000-0000-4000-8000-000000000969', 'POTHOLE', 'REPORTED', pg_temp.pt(18.95, 72.95, 10, 0), now() - interval '31 days'),
  -- B7: element shape (12.34 m due north)
  ('10000000-0000-4000-8000-000000000971', 'FOOTPATH', 'REPORTED', pg_temp.pt(18.96, 72.95, 12.34, 0), now() - interval '3 hours');
insert into public.issues (id, category, status, assigned_department_id, geom, created_at) values
  ('10000000-0000-4000-8000-000000000962', 'POTHOLE', 'ASSIGNED',    'd0000000-0000-4000-8000-000000000901', pg_temp.pt(18.95, 72.95, 10, 0), now() - interval '2 days'),
  ('10000000-0000-4000-8000-000000000963', 'POTHOLE', 'IN_PROGRESS', 'd0000000-0000-4000-8000-000000000901', pg_temp.pt(18.95, 72.95, 10, 0), now() - interval '3 days');
insert into public.issues (id, category, status, assigned_department_id, resolved_at, geom, created_at) values
  ('10000000-0000-4000-8000-000000000964', 'POTHOLE', 'RESOLVED', 'd0000000-0000-4000-8000-000000000901', now(), pg_temp.pt(18.95, 72.95, 10, 0), now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000967', 'POTHOLE', 'REOPENED', 'd0000000-0000-4000-8000-000000000901', now(), pg_temp.pt(18.95, 72.95, 10, 0), now() - interval '1 hour');
insert into public.issues (id, category, status, merged_into_issue_id, geom, created_at) values
  ('10000000-0000-4000-8000-000000000965', 'POTHOLE', 'MERGED', '10000000-0000-4000-8000-000000000961', pg_temp.pt(18.95, 72.95, 10, 0), now() - interval '1 hour');

-- B7 reports: the earliest (…0972) is neither inserted first nor the smallest id.
insert into public.reports (id, issue_id, reporter_user_id, reporter_ip_hash, category, description, image_path, geom, created_at) values
  ('20000000-0000-4000-8000-000000000971', '10000000-0000-4000-8000-000000000971', '00000000-0000-4000-8000-000000000901', 'iphash-090',
   'FOOTPATH', 'second', '00000000-0000-4000-8000-000000000901/a.jpg', pg_temp.pt(18.96, 72.95, 12.34, 0), now() - interval '2 hours'),
  ('20000000-0000-4000-8000-000000000972', '10000000-0000-4000-8000-000000000971', '00000000-0000-4000-8000-000000000902', 'iphash-090',
   'FOOTPATH', 'first', '00000000-0000-4000-8000-000000000902/a.jpg', pg_temp.pt(18.96, 72.95, 12.34, 0), now() - interval '3 hours'),
  ('20000000-0000-4000-8000-000000000973', '10000000-0000-4000-8000-000000000971', '00000000-0000-4000-8000-000000000903', 'iphash-090',
   'OTHER', 'third', '00000000-0000-4000-8000-000000000903/a.jpg', pg_temp.pt(18.96, 72.95, 50, 0), now() - interval '1 hour');

set local role service_role;

-- Per-category radius (B1) -----------------------------------------------------------------------
do $$ begin
  perform pg_temp.assert_eq('STREETLIGHT 30 m',  pg_temp.ids(pg_temp.dc(18.90, 'STREETLIGHT')), '{11}'::text[]);
  perform pg_temp.assert_eq('POTHOLE 50 m',      pg_temp.ids(pg_temp.dc(18.90, 'POTHOLE')),     '{13}'::text[]);
  perform pg_temp.assert_eq('GARBAGE 75 m',      pg_temp.ids(pg_temp.dc(18.90, 'GARBAGE')),     '{15}'::text[]);
  perform pg_temp.assert_eq('DRAINAGE 150 m',    pg_temp.ids(pg_temp.dc(18.90, 'DRAINAGE')),    '{17}'::text[]);
  perform pg_temp.assert_eq('distance of the inside STREETLIGHT',
    (pg_temp.dc(18.90, 'STREETLIGHT') -> 0 ->> 'distance_m')::numeric, 29.5);
  perform pg_temp.assert_eq('distance of the inside DRAINAGE',
    (pg_temp.dc(18.90, 'DRAINAGE') -> 0 ->> 'distance_m')::numeric, 149.5);
  -- WATERLOGGING (150 m) sees the DRAINAGE one inside 150 m as FAMILY, not the one outside
  perform pg_temp.assert_eq('WATERLOGGING 150 m → family DRAINAGE', pg_temp.ids(pg_temp.dc(18.90, 'WATERLOGGING')), '{17}'::text[]);
  -- radii come from p_config
  perform pg_temp.assert_eq('POTHOLE with a 51 m radius from config',
    pg_temp.ids(pg_temp.dc(18.90, 'POTHOLE', pg_temp.dcfg(p_radii => '{"POTHOLE": 51}'))), '{13,14}'::text[]);
  perform pg_temp.assert_eq('POTHOLE with a 49 m radius from config',
    pg_temp.ids(pg_temp.dc(18.90, 'POTHOLE', pg_temp.dcfg(p_radii => '{"POTHOLE": 49}'))), '{}'::text[]);
  perform pg_temp.assert_eq('nothing at all → empty array', pg_temp.dc(18.905, 'POTHOLE'), '[]'::jsonb);
end $$;

-- Radius of the NEW report's category (B2, B3) ---------------------------------------------------
do $$ declare res jsonb; begin
  res := pg_temp.dc(18.91, 'WATERLOGGING');   -- 150 m: finds the WATER_LEAK issue 120 m away
  perform pg_temp.assert_eq('WATERLOGGING finds WATER_LEAK at 120 m', pg_temp.ids(res), '{21}'::text[]);
  perform pg_temp.assert_eq('… as FAMILY', res -> 0 ->> 'match', 'FAMILY');
  perform pg_temp.assert_eq('… at 120 m', (res -> 0 ->> 'distance_m')::numeric, 120.0);
  perform pg_temp.assert_eq('DRAINAGE (150 m) finds it too', pg_temp.ids(pg_temp.dc(18.91, 'DRAINAGE')), '{21}'::text[]);
  perform pg_temp.assert_eq('WATER_LEAK (75 m) does not find WATERLOGGING at 120 m',
    pg_temp.ids(pg_temp.dc(18.92, 'WATER_LEAK')), '{}'::text[]);
  perform pg_temp.assert_eq('WATER_LEAK exact at 120 m is out of its own 75 m',
    pg_temp.ids(pg_temp.dc(18.91, 'WATER_LEAK')), '{}'::text[]);
end $$;

-- Families (B4) ----------------------------------------------------------------------------------
do $$ declare res jsonb; begin
  res := pg_temp.dc(18.93, 'DRAINAGE');
  perform pg_temp.assert_eq('DRAINAGE: exact then family by distance', pg_temp.ids(res), '{41,42,43}'::text[]);
  perform pg_temp.assert_eq('DRAINAGE matches', array(select e ->> 'match' from jsonb_array_elements(res) e),
    '{EXACT,FAMILY,FAMILY}'::text[]);
  perform pg_temp.assert_eq('WATERLOGGING', pg_temp.ids(pg_temp.dc(18.93, 'WATERLOGGING')), '{42,41,43}'::text[]);
  perform pg_temp.assert_eq('WATER_LEAK',   pg_temp.ids(pg_temp.dc(18.93, 'WATER_LEAK')),   '{43,41,42}'::text[]);
  perform pg_temp.assert_eq('POTHOLE never matches GARBAGE', pg_temp.ids(pg_temp.dc(18.93, 'POTHOLE')), '{44}'::text[]);
  perform pg_temp.assert_eq('GARBAGE never matches POTHOLE', pg_temp.ids(pg_temp.dc(18.93, 'GARBAGE')), '{45}'::text[]);
  perform pg_temp.assert_eq('STREETLIGHT matches none of them', pg_temp.ids(pg_temp.dc(18.93, 'STREETLIGHT')), '{}'::text[]);
  -- families come from p_config
  perform pg_temp.assert_eq('no families configured → exact only',
    pg_temp.ids(pg_temp.dc(18.93, 'DRAINAGE', pg_temp.dcfg(p_families => '[]'))), '{41}'::text[]);
  perform pg_temp.assert_eq('a configured POTHOLE/GARBAGE family',
    pg_temp.ids(pg_temp.dc(18.93, 'POTHOLE', pg_temp.dcfg(p_families => '[["POTHOLE", "GARBAGE"]]'))), '{44,45}'::text[]);
  perform pg_temp.assert_eq('category_family_mates',
    (select array_agg(c order by c) from unnest(public.category_family_mates('WATER_LEAK', '[["DRAINAGE", "WATERLOGGING", "WATER_LEAK"]]')) c),
    '{WATER_LEAK,DRAINAGE,WATERLOGGING}'::public.issue_category[]);
  perform pg_temp.assert_eq('category_family_mates: in no family',
    public.category_family_mates('POTHOLE', '[["DRAINAGE", "WATERLOGGING", "WATER_LEAK"]]'), '{}'::public.issue_category[]);
end $$;

-- Ranking + max_candidates (B5) ------------------------------------------------------------------
do $$ declare res jsonb; begin
  res := pg_temp.dc(18.94, 'DRAINAGE');
  -- EXACT (53 & 52 at 40 m: newer 53 first; then 51 at 100 m) before FAMILY (54 at 5 m, 55 at 60 m);
  -- the 6th eligible (56, family at 120 m) is cut by max_candidates 5.
  perform pg_temp.assert_eq('ranking', pg_temp.ids(res), '{53,52,51,54,55}'::text[]);
  perform pg_temp.assert_eq('equal distance', (res -> 0 ->> 'distance_m')::numeric, (res -> 1 ->> 'distance_m')::numeric);
  perform pg_temp.assert_eq('max_candidates 2 from config',
    pg_temp.ids(pg_temp.dc(18.94, 'DRAINAGE', pg_temp.dcfg(p_max => 2))), '{53,52}'::text[]);
  perform pg_temp.assert_eq('max_candidates 10 from config',
    pg_temp.ids(pg_temp.dc(18.94, 'DRAINAGE', pg_temp.dcfg(p_max => 10))), '{53,52,51,54,55,56}'::text[]);
  -- from WATERLOGGING's point of view 54 and 56 are EXACT
  perform pg_temp.assert_eq('ranking for WATERLOGGING',
    pg_temp.ids(pg_temp.dc(18.94, 'WATERLOGGING', pg_temp.dcfg(p_max => 10))), '{54,56,53,52,55,51}'::text[]);
end $$;

-- Exclusions (B6) --------------------------------------------------------------------------------
do $$ begin
  -- open statuses only (not RESOLVED 64, MERGED 65, REJECTED 66, REOPENED 67), within 30 days (not 69)
  perform pg_temp.assert_eq('statuses + 30-day window', pg_temp.ids(pg_temp.dc(18.95, 'POTHOLE')), '{61,62,63,68}'::text[]);
  perform pg_temp.assert_eq('window_days 1 from config',
    pg_temp.ids(pg_temp.dc(18.95, 'POTHOLE', pg_temp.dcfg(p_window_days => 1))), '{61}'::text[]);
  perform pg_temp.assert_eq('window_days 60 from config',
    pg_temp.ids(pg_temp.dc(18.95, 'POTHOLE', pg_temp.dcfg(p_window_days => 60))), '{61,62,63,68,69}'::text[]);
  perform pg_temp.assert_eq('candidate_statuses from config',
    pg_temp.ids(pg_temp.dc(18.95, 'POTHOLE', pg_temp.dcfg(p_statuses => '["REPORTED"]'))), '{61,68}'::text[]);
  perform pg_temp.assert_eq('candidate_statuses incl. REOPENED (stretch)',
    pg_temp.ids(pg_temp.dc(18.95, 'POTHOLE', pg_temp.dcfg(p_statuses => '["REPORTED", "REOPENED"]'))), '{61,67,68}'::text[]);
end $$;

-- Element shape (B7) -----------------------------------------------------------------------------
do $$ declare res jsonb; e jsonb; i public.issues%rowtype; begin
  res := pg_temp.dc(18.96, 'FOOTPATH');
  perform pg_temp.assert_eq('one candidate', jsonb_array_length(res), 1);
  e := res -> 0;
  select * into strict i from public.issues where id = '10000000-0000-4000-8000-000000000971';
  perform pg_temp.assert_eq('keys', (select array_agg(k order by k) from jsonb_object_keys(e) k),
    array['category', 'created_at', 'distance_m', 'id', 'lat', 'lng', 'match', 'primary_report_id', 'report_count', 'status']);
  perform pg_temp.assert_eq('id', e ->> 'id', i.id::text);
  perform pg_temp.assert_eq('category', e ->> 'category', 'FOOTPATH');
  perform pg_temp.assert_eq('status', e ->> 'status', 'REPORTED');
  perform pg_temp.assert_eq('distance_m is a number', jsonb_typeof(e -> 'distance_m'), 'number');
  perform pg_temp.assert_eq('distance_m rounded to 1 decimal', e -> 'distance_m', '12.3'::jsonb);
  perform pg_temp.assert_eq('report_count', e -> 'report_count', '3'::jsonb);
  perform pg_temp.assert_eq('primary_report_id = earliest report', e ->> 'primary_report_id', '20000000-0000-4000-8000-000000000972');
  perform pg_temp.assert_eq('created_at', (e ->> 'created_at')::timestamptz, i.created_at);
  perform pg_temp.assert_eq('match', e ->> 'match', 'EXACT');
  perform pg_temp.assert_eq('lat', (e ->> 'lat')::float8, st_y(i.geom::geometry));
  perform pg_temp.assert_eq('lng', (e ->> 'lng')::float8, st_x(i.geom::geometry));
  if res::text like '%00000000-0000-4000-8000-00000000090%' or res::text like '%iphash%' or res::text like '%.jpg%' then
    raise exception 'duplicate_candidates leaks reporter ids, ip hashes or paths: %', res;
  end if;
  -- an issue with no report rows still comes back (primary_report_id null)
  perform pg_temp.assert_eq('no reports → null primary', pg_temp.dc(18.90, 'POTHOLE') -> 0 -> 'primary_report_id', 'null'::jsonb);
  perform pg_temp.assert_eq('no reports → count 0', pg_temp.dc(18.90, 'POTHOLE') -> 0 -> 'report_count', '0'::jsonb);
end $$;

-- Input and config errors ------------------------------------------------------------------------
do $$ begin
  perform pg_temp.expect_error($q$select public.duplicate_candidates(18.9, 72.95, null, pg_temp.dcfg())$q$,
    'PT400', 'VALIDATION_FAILED', 'category required');
  perform pg_temp.expect_error($q$select public.duplicate_candidates(91, 72.95, 'POTHOLE', pg_temp.dcfg())$q$,
    'PT400', 'VALIDATION_FAILED', 'invalid location');
  perform pg_temp.expect_error($q$select public.duplicate_candidates(null, 72.95, 'POTHOLE', pg_temp.dcfg())$q$,
    'PT400', 'VALIDATION_FAILED', 'invalid location');
  -- missing config keys are programming errors (→ INTERNAL), never a silent default
  perform pg_temp.expect_error($q$select public.duplicate_candidates(18.9, 72.95, 'POTHOLE', null)$q$, '22023');
  perform pg_temp.expect_error($q$select public.duplicate_candidates(18.9, 72.95, 'POTHOLE', pg_temp.dcfg() - 'window_days')$q$, '22023');
  perform pg_temp.expect_error($q$select public.duplicate_candidates(18.9, 72.95, 'POTHOLE', pg_temp.dcfg() - 'max_candidates')$q$, '22023');
  perform pg_temp.expect_error($q$select public.duplicate_candidates(18.9, 72.95, 'POTHOLE', pg_temp.dcfg() - 'candidate_statuses')$q$, '22023');
  perform pg_temp.expect_error($q$select public.duplicate_candidates(18.9, 72.95, 'POTHOLE', pg_temp.dcfg() - 'compatible_families')$q$, '22023');
  perform pg_temp.expect_error($q$select public.duplicate_candidates(18.9, 72.95, 'POTHOLE', pg_temp.dcfg(p_radii => '{"GARBAGE": 75}'))$q$, '22023');
end $$;

reset role;

-- The radius predicate is index-friendly: with seq scans off, the same ST_DWithin shape uses issues_geom_gix.
do $$ declare v_line text; v_plan text := ''; begin
  set local enable_seqscan = off;
  for v_line in execute $q$explain select 1 from public.issues i
    where st_dwithin(i.geom, st_setsrid(st_makepoint(72.95, 18.9), 4326)::geography, 50::float8)$q$ loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  if v_plan not like '%issues_geom_gix%' then raise exception 'ST_DWithin does not use issues_geom_gix: %', v_plan; end if;
  set local enable_seqscan = on;
end $$;

rollback;

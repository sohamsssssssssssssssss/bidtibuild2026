-- City Pulse (02 §6; 04 §3; 06 rules 1, 3, 7): regenerate_city_pulse(p_config) + active_hotspots().
-- Passes with and without the seed: every fixture sits at its own site around lat 19.19–19.23,
-- lng 72.95–73.03 (> 10 km from the seeded issues), sites ~2 km apart, and every assertion is scoped
-- to the hotspot that holds a given fixture issue. Fixtures are inserted directly (superuser) with
-- back-dated created_at; now() is the transaction time, the same clock regenerate_city_pulse uses.
-- regenerate deactivates EVERY active hotspot (seeded scenario included) — fine, all rolled back.
begin;

create function pg_temp.assert_eq(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception '%: expected % got %', p_label, p_want, p_got; end if;
end $$;
grant execute on function pg_temp.assert_eq(text, anyelement, anyelement) to public;

-- CITY_PULSE_CONFIG (src/config/civic.ts), as the routes pass it, shallow-patched per case.
create function pg_temp.cfg(p_patch jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'input_window_hours', 8,
    'input_statuses', '["REPORTED", "ASSIGNED", "IN_PROGRESS"]'::jsonb,
    'cluster_srid', 32643,
    'cluster_eps_m', 300,
    'cluster_min_points', 4,
    'current_window_hours', 2,
    'baseline_window_hours', 6,
    'baseline_divisor', 3,
    'expected_floor', 1,
    'min_current_count', 4,
    'trend_thresholds_percent', '{"MEDIUM": 50, "HIGH": 100, "CRITICAL": 200}'::jsonb,
    'critical_min_current_count', 6,
    'buffer_m', 50) || p_patch
$$;
grant execute on function pg_temp.cfg(jsonb) to public;

create function pg_temp.run(p_patch jsonb default '{}') returns jsonb language sql as $$
  select public.regenerate_city_pulse(pg_temp.cfg(p_patch))
$$;

-- Fixtures ---------------------------------------------------------------------------------------
create temp table t_ids (name text primary key, id uuid not null unique);

insert into public.departments (id, name, sla_hours)
values ('00000000-0000-4000-8000-0000000110d1', 'Test 110 department', 72);

-- Site k: its own centre in EPSG:32643 (metres).
create function pg_temp.site(k int) returns geometry language sql as $$
  select st_transform(st_setsrid(st_makepoint(72.95 + (k % 5) * 0.02, 19.19 + (k / 5) * 0.02), 4326), 32643)
$$;

create function pg_temp.mk(p_name text, p_category public.issue_category, p_site int, p_dx float8, p_dy float8,
                           p_ago interval, p_status public.issue_status default 'REPORTED')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_target uuid;
begin
  if p_status = 'MERGED' then
    select id into v_target from t_ids where name like split_part(p_name, '.', 1) || '.%' order by name limit 1;
  end if;
  insert into public.issues (id, category, status, geom, created_at, updated_at, assigned_department_id,
                             assigned_at, resolved_at, merged_into_issue_id)
  values (v_id, p_category, p_status,
          st_transform(st_translate(pg_temp.site(p_site), p_dx, p_dy), 4326)::geography,
          now() - p_ago, now() - p_ago,
          case when p_status in ('ASSIGNED', 'IN_PROGRESS') then '00000000-0000-4000-8000-0000000110d1'::uuid end,
          case when p_status in ('ASSIGNED', 'IN_PROGRESS') then now() - p_ago end,
          case when p_status = 'RESOLVED' then now() end,
          v_target);
  insert into t_ids values (p_name, v_id);
  return v_id;
end $$;

-- n issues of one category at a site, packed within ~100 m: <prefix>.c<i> current (10–60 min ago),
-- <prefix>.b<i> baseline (3 h – 6 h 50 min ago).
create function pg_temp.pack(p_prefix text, p_category public.issue_category, p_site int, p_current int, p_baseline int)
returns void language plpgsql as $$
declare i int;
begin
  for i in 1..p_current loop
    perform pg_temp.mk(format('%s.c%s', p_prefix, lpad(i::text, 2, '0')), p_category, p_site,
                       ((i - 1) % 5) * 20, ((i - 1) / 5) * 20, make_interval(mins => 5 + i * 5));
  end loop;
  for i in 1..p_baseline loop
    perform pg_temp.mk(format('%s.b%s', p_prefix, lpad(i::text, 2, '0')), p_category, p_site,
                       ((i - 1) % 5) * 20 + 10, ((i - 1) / 5) * 20 + 10, make_interval(hours => 3, mins => i * 10));
  end loop;
end $$;

do $$ begin
  -- site 0 "chain": two dense groups 240 m apart, ends 640 m apart → one cluster (core-to-core link).
  perform pg_temp.mk('chain.' || x, 'STREETLIGHT', 0, x, 0, make_interval(mins => 20 + x / 10))
  from unnest(array[0, 80, 160, 240, 480, 560, 640]) x;
  -- site 1 "line": 4 collinear current POTHOLEs (0–290 m) + one 350 m beyond the last (noise).
  perform pg_temp.mk('line.' || x, 'POTHOLE', 1, x, 0, make_interval(mins => 15 + x / 10))
  from unnest(array[0, 100, 200, 290]) x;
  perform pg_temp.mk('line.noise', 'POTHOLE', 1, 640, 0, interval '30 minutes');
  -- site 2 "minpts": 3 GARBAGE within 40 m → below cluster_min_points.
  perform pg_temp.pack('minpts', 'GARBAGE', 2, 3, 0);
  -- site 3 "mixed": 4 FOOTPATH + 3 OTHER on the same spot → categories never mix.
  perform pg_temp.pack('mixed_fp', 'FOOTPATH', 3, 4, 0);
  perform pg_temp.pack('mixed_ot', 'OTHER', 3, 3, 0);
  -- site 4 "window": 4 counted WATER_LEAK issues (REPORTED ×2, ASSIGNED, IN_PROGRESS) + ignored ones.
  perform pg_temp.mk('window.a', 'WATER_LEAK', 4, 0, 0, interval '20 minutes');
  perform pg_temp.mk('window.b', 'WATER_LEAK', 4, 20, 0, interval '30 minutes');
  perform pg_temp.mk('window.c', 'WATER_LEAK', 4, 40, 0, interval '40 minutes', 'ASSIGNED');
  perform pg_temp.mk('window.d', 'WATER_LEAK', 4, 60, 0, interval '50 minutes', 'IN_PROGRESS');
  perform pg_temp.mk('window.x_resolved', 'WATER_LEAK', 4, 0, 20, interval '25 minutes', 'RESOLVED');
  perform pg_temp.mk('window.x_rejected', 'WATER_LEAK', 4, 20, 20, interval '25 minutes', 'REJECTED');
  perform pg_temp.mk('window.x_merged', 'WATER_LEAK', 4, 40, 20, interval '25 minutes', 'MERGED');
  perform pg_temp.mk('window.x_old', 'WATER_LEAK', 4, 60, 20, interval '9 hours');
  -- Three supporting reports on window.a: reports never add to a count (02 §6.1).
  insert into public.reports (issue_id, reporter_user_id, category, description, image_path, geom, created_at)
  select t.id, gen_random_uuid(), 'WATER_LEAK', 'Same leak', 'x/y.jpg', i.geom, now() - interval '10 minutes'
  from t_ids t join public.issues i on i.id = t.id, generate_series(1, 3)
  where t.name = 'window.a';
  -- Trend / severity table (02 §6.4–6.5).
  perform pg_temp.pack('crit',    'DRAINAGE',        5, 6, 1);   -- 566.7 %, current 6 → CRITICAL
  perform pg_temp.pack('high100', 'WATERLOGGING',    6, 4, 6);   -- expected 2, 100 % → HIGH
  perform pg_temp.pack('low33',   'PUBLIC_PROPERTY', 7, 4, 9);   -- expected 3, 33.3 % → LOW
  perform pg_temp.pack('med50',   'POTHOLE',         8, 6, 12);  -- expected 4, exactly 50 % → MEDIUM
  perform pg_temp.pack('neg',     'GARBAGE',         9, 4, 15);  -- expected 5, -20 % → LOW
  perform pg_temp.pack('few',     'STREETLIGHT',    10, 3, 10);  -- current 3 < min_current_count → none
  perform pg_temp.pack('crit200', 'FOOTPATH',       11, 6, 6);   -- expected 2, exactly 200 %, current 6 → CRITICAL
end $$;

-- Lookups --------------------------------------------------------------------------------------------
-- The active hotspot (as active_hotspots() returns it) holding fixture issue p_name, else null.
create function pg_temp.hot(p_name text) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.active_hotspots()) e
  where exists (select 1 from public.hotspot_issues hi join t_ids t on t.id = hi.issue_id
                where hi.hotspot_id = (e ->> 'id')::uuid and t.name = p_name)
$$;
-- Fixture names of a hotspot's members (hotspot_issues), sorted.
create function pg_temp.members(p_hotspot jsonb) returns text[] language sql as $$
  select array_agg(t.name order by t.name) from public.hotspot_issues hi join t_ids t on t.id = hi.issue_id
  where hi.hotspot_id = (p_hotspot ->> 'id')::uuid
$$;
create function pg_temp.names(p_like text) returns text[] language sql as $$
  select array_agg(name order by name) from t_ids where name like p_like
$$;

-- Default config ---------------------------------------------------------------------------------------
do $$
declare v_res jsonb; h jsonb;
begin
  v_res := pg_temp.run();
  perform pg_temp.assert_eq('generated_at = transaction time', (v_res ->> 'generated_at')::timestamptz, now());
  perform pg_temp.assert_eq('returned set = active_hotspots()', v_res -> 'hotspots', public.active_hotspots());
  perform pg_temp.assert_eq('one generated_at among active rows',
    (select count(distinct generated_at)::int from public.hotspots where active), 1);
  perform pg_temp.assert_eq('active rows generated now',
    (select bool_and(generated_at = now() and window_end = now() and window_start = now() - interval '8 hours')
     from public.hotspots where active), true);
  perform pg_temp.assert_eq('returned count = active rows',
    jsonb_array_length(v_res -> 'hotspots'), (select count(*)::int from public.hotspots where active));

  -- Clustering (§6.3)
  h := pg_temp.hot('chain.0');
  perform pg_temp.assert_eq('chain: one cluster of 7', pg_temp.members(h), pg_temp.names('chain.%'));
  perform pg_temp.assert_eq('chain: severity', h ->> 'severity', 'CRITICAL');
  perform pg_temp.assert_eq('chain: explanation', h ->> 'explanation',
    '7 STREETLIGHT issues within ~300 m in the last 2 h (expected 0.0) — trend +700%.');

  h := pg_temp.hot('line.0');
  perform pg_temp.assert_eq('line: members exclude the noise point', pg_temp.members(h),
    array['line.0', 'line.100', 'line.200', 'line.290']);
  perform pg_temp.assert_eq('line: noise is in no hotspot', pg_temp.hot('line.noise'), null::jsonb);
  perform pg_temp.assert_eq('line: current', (h ->> 'current_issue_count')::int, 4);
  perform pg_temp.assert_eq('line: baseline', (h ->> 'baseline_issue_count')::int, 0);
  perform pg_temp.assert_eq('line: trend 400', (h ->> 'trend_percent')::numeric, 400.0);
  perform pg_temp.assert_eq('line: 400 % with current 4 is capped at HIGH', h ->> 'severity', 'HIGH');
  perform pg_temp.assert_eq('line: explanation', h ->> 'explanation',
    '4 POTHOLE issues within ~300 m in the last 2 h (expected 0.0) — trend +400%.');

  perform pg_temp.assert_eq('minpts: 3 points → no cluster', pg_temp.hot('minpts.c01'), null::jsonb);

  h := pg_temp.hot('mixed_fp.c01');
  perform pg_temp.assert_eq('mixed: FOOTPATH members only', pg_temp.members(h), pg_temp.names('mixed_fp.%'));
  perform pg_temp.assert_eq('mixed: category', h ->> 'category', 'FOOTPATH');
  perform pg_temp.assert_eq('mixed: OTHER never clustered with FOOTPATH', pg_temp.hot('mixed_ot.c01'), null::jsonb);

  -- Window, statuses, supporting reports (§6.1–6.2)
  h := pg_temp.hot('window.a');
  perform pg_temp.assert_eq('window: members', pg_temp.members(h),
    array['window.a', 'window.b', 'window.c', 'window.d']);
  perform pg_temp.assert_eq('window: current (reports do not count)', (h ->> 'current_issue_count')::int, 4);
  perform pg_temp.assert_eq('window: baseline (9 h old issue ignored)', (h ->> 'baseline_issue_count')::int, 0);
  perform pg_temp.assert_eq('window: ignored issues in no hotspot',
    (select count(*)::int from public.hotspot_issues hi join public.hotspots hs on hs.id = hi.hotspot_id
     join t_ids t on t.id = hi.issue_id where hs.active and t.name like 'window.x_%'), 0);

  -- Trend + severity (§6.4–6.5); stored at full precision, rounded in the output.
  h := pg_temp.hot('crit.c01');
  perform pg_temp.assert_eq('crit: members = current + baseline', pg_temp.members(h), pg_temp.names('crit.%'));
  perform pg_temp.assert_eq('crit: severity', h ->> 'severity', 'CRITICAL');
  perform pg_temp.assert_eq('crit: counts', array[(h ->> 'current_issue_count')::int, (h ->> 'baseline_issue_count')::int], array[6, 1]);
  perform pg_temp.assert_eq('crit: expected (2 dp)', h -> 'expected_current_count', '0.33'::jsonb);
  perform pg_temp.assert_eq('crit: trend (1 dp)', h -> 'trend_percent', '566.7'::jsonb);
  perform pg_temp.assert_eq('crit: explanation', h ->> 'explanation',
    '6 DRAINAGE issues within ~300 m in the last 2 h (expected 0.3) — trend +566%.');
  perform pg_temp.assert_eq('crit: stored at full precision',
    (select expected_current_count = 1::numeric / 3 and trend_percent > 566.66 and trend_percent < 566.67
     from public.hotspots where id = (h ->> 'id')::uuid), true);

  h := pg_temp.hot('high100.c01');
  perform pg_temp.assert_eq('high100: membership incl. baseline', cardinality(pg_temp.members(h)), 10);
  perform pg_temp.assert_eq('high100: severity', h ->> 'severity', 'HIGH');
  perform pg_temp.assert_eq('high100: expected', (h ->> 'expected_current_count')::numeric, 2.00);
  perform pg_temp.assert_eq('high100: trend', (h ->> 'trend_percent')::numeric, 100.0);
  perform pg_temp.assert_eq('high100: explanation', h ->> 'explanation',
    '4 WATERLOGGING issues within ~300 m in the last 2 h (expected 2.0) — trend +100%.');

  h := pg_temp.hot('low33.c01');
  perform pg_temp.assert_eq('low33: severity', h ->> 'severity', 'LOW');
  perform pg_temp.assert_eq('low33: trend', h -> 'trend_percent', '33.3'::jsonb);
  perform pg_temp.assert_eq('low33: expected', (h ->> 'expected_current_count')::numeric, 3.00);
  perform pg_temp.assert_eq('low33: explanation', h ->> 'explanation',
    '4 PUBLIC_PROPERTY issues within ~300 m in the last 2 h (expected 3.0) — trend +33%.');

  h := pg_temp.hot('med50.c01');
  perform pg_temp.assert_eq('med50: exactly 50 % is MEDIUM', h ->> 'severity', 'MEDIUM');
  perform pg_temp.assert_eq('med50: trend', (h ->> 'trend_percent')::numeric, 50.0);

  h := pg_temp.hot('neg.c01');
  perform pg_temp.assert_eq('neg: severity', h ->> 'severity', 'LOW');
  perform pg_temp.assert_eq('neg: trend', (h ->> 'trend_percent')::numeric, -20.0);
  perform pg_temp.assert_eq('neg: explanation (minus sign)', h ->> 'explanation',
    '4 GARBAGE issues within ~300 m in the last 2 h (expected 5.0) — trend -20%.');

  perform pg_temp.assert_eq('few: current 3 → not an active hotspot', pg_temp.hot('few.c01'), null::jsonb);
  perform pg_temp.assert_eq('few: baseline members not in any hotspot', pg_temp.hot('few.b01'), null::jsonb);

  h := pg_temp.hot('crit200.c01');
  perform pg_temp.assert_eq('crit200: exactly 200 % with current 6 is CRITICAL', h ->> 'severity', 'CRITICAL');

  -- Geometry (§6.6)
  perform pg_temp.assert_eq('every active fixture hotspot is a Polygon covering all its members',
    (select bool_and(st_geometrytype(hs.geom::geometry) = 'ST_Polygon' and st_covers(hs.geom, i.geom))
     from public.hotspots hs join public.hotspot_issues hi on hi.hotspot_id = hs.id
     join public.issues i on i.id = hi.issue_id join t_ids t on t.id = i.id where hs.active), true);
  h := pg_temp.hot('line.0');
  perform pg_temp.assert_eq('collinear members still give an area (> 2·50·290 m²)',
    (select st_area(geom) > 29000 from public.hotspots where id = (h ->> 'id')::uuid), true);
  perform pg_temp.assert_eq('GeoJSON geometry', h -> 'geometry' ->> 'type', 'Polygon');
  perform pg_temp.assert_eq('GeoJSON ring closed, 6 decimals',
    (select (r -> 0) = (r -> -1) and length(split_part(r -> 0 ->> 0, '.', 2)) <= 6
     from (select h -> 'geometry' -> 'coordinates' -> 0 as r) x), true);
end $$;

-- Stored as geography(Polygon, 4326).
do $$ begin
  perform pg_temp.assert_eq('hotspots.geom type',
    (select format_type(atttypid, atttypmod) from pg_attribute
     where attrelid = 'public.hotspots'::regclass and attname = 'geom'), 'geography(Polygon,4326)');
end $$;

-- active_hotspots(): shape and ordering ---------------------------------------------------------------
do $$
declare v jsonb := public.active_hotspots(); h jsonb;
begin
  perform pg_temp.assert_eq('active_hotspots is an array', jsonb_typeof(v), 'array');
  perform pg_temp.assert_eq('element keys',
    (select array_agg(k order by k) from jsonb_object_keys(v -> 0) k),
    array['baseline_issue_count', 'category', 'current_issue_count', 'expected_current_count', 'explanation',
          'generated_at', 'geometry', 'id', 'member_issue_ids', 'severity', 'trend_percent', 'window_end',
          'window_start']);
  perform pg_temp.assert_eq('order: severity CRITICAL→LOW, current desc, id',
    (select array_agg(e ->> 'id' order by o) from jsonb_array_elements(v) with ordinality x(e, o)),
    (select array_agg(e ->> 'id' order by (e ->> 'severity')::public.level desc,
                      (e ->> 'current_issue_count')::int desc, (e ->> 'id')::uuid)
     from jsonb_array_elements(v) e));
  -- CRITICAL first: chain (7) before crit/crit200 (6, ordered by id).
  perform pg_temp.assert_eq('CRITICAL with more current issues first',
    (select (x.o < y.o) from
       (select o from jsonb_array_elements(v) with ordinality a(e, o) where e = pg_temp.hot('chain.0')) x,
       (select o from jsonb_array_elements(v) with ordinality a(e, o) where e = pg_temp.hot('crit.c01')) y), true);

  h := pg_temp.hot('high100.c01');
  perform pg_temp.assert_eq('member_issue_ids ordered by created_at',
    (select array_agg(m::uuid order by o) from jsonb_array_elements_text(h -> 'member_issue_ids') with ordinality x(m, o)),
    (select array_agg(i.id order by i.created_at, i.id) from public.issues i join t_ids t on t.id = i.id
     where t.name like 'high100.%'));
end $$;

-- A member rejected after the run is hidden from member_issue_ids (still in hotspot_issues, counts kept).
update public.issues set status = 'REJECTED' where id = (select id from t_ids where name = 'high100.b01');
do $$
declare h jsonb := pg_temp.hot('high100.c01');
begin
  perform pg_temp.assert_eq('REJECTED member hidden', jsonb_array_length(h -> 'member_issue_ids'), 9);
  perform pg_temp.assert_eq('REJECTED member not listed',
    (h -> 'member_issue_ids') ? (select id::text from t_ids where name = 'high100.b01'), false);
  perform pg_temp.assert_eq('provenance kept', cardinality(pg_temp.members(h)), 10);
  perform pg_temp.assert_eq('counts kept', (h ->> 'baseline_issue_count')::int, 6);
end $$;
update public.issues set status = 'REPORTED' where id = (select id from t_ids where name = 'high100.b01');

-- Re-running: the previous set stays as inactive history -------------------------------------------
create temp table t_prev as select id from public.hotspots where active;
do $$
declare v_res jsonb;
begin
  v_res := pg_temp.run();
  perform pg_temp.assert_eq('previous hotspots deactivated, still present',
    (select count(*)::int from public.hotspots h join t_prev p using (id) where not h.active),
    (select count(*)::int from t_prev));
  perform pg_temp.assert_eq('previous memberships kept',
    (select count(*) > 0 from public.hotspot_issues hi join t_prev p on p.id = hi.hotspot_id), true);
  perform pg_temp.assert_eq('no previous hotspot is active',
    (select count(*)::int from public.hotspots h join t_prev p using (id) where h.active), 0);
  perform pg_temp.assert_eq('same number of new active hotspots',
    (select count(*)::int from public.hotspots where active), (select count(*)::int from t_prev));
  perform pg_temp.assert_eq('returned set = active_hotspots() after re-run', v_res -> 'hotspots', public.active_hotspots());
end $$;

-- Config-driven (every number from p_config) ----------------------------------------------------------
do $$
declare h jsonb; v_area50 float8; v_area100 float8;
begin
  -- eps 400: the point 350 m beyond the line joins it.
  perform pg_temp.run('{"cluster_eps_m": 400}');
  h := pg_temp.hot('line.0');
  perform pg_temp.assert_eq('eps 400: noise joins', pg_temp.members(h),
    array['line.0', 'line.100', 'line.200', 'line.290', 'line.noise']);
  perform pg_temp.assert_eq('eps 400: explanation', h ->> 'explanation',
    '5 POTHOLE issues within ~400 m in the last 2 h (expected 0.0) — trend +500%.');

  -- min_current 3 alone: OTHER (3) sits on the FOOTPATH (4) spot, but DBSCAN runs per category, so
  -- its 3 points never reach minpoints 4 by borrowing FOOTPATH neighbours.
  perform pg_temp.run('{"min_current_count": 3}');
  perform pg_temp.assert_eq('min_current 3: OTHER still no cluster', pg_temp.hot('mixed_ot.c01'), null::jsonb);
  perform pg_temp.assert_eq('min_current 3: FOOTPATH members unchanged',
    pg_temp.members(pg_temp.hot('mixed_fp.c01')), pg_temp.names('mixed_fp.%'));
  perform pg_temp.assert_eq('min_current 3: few now active', (pg_temp.hot('few.c01') ->> 'current_issue_count')::int, 3);

  -- minpoints 3 alone: a 3-issue cluster exists but current 3 < min_current_count; with 3 too → hotspot.
  perform pg_temp.run('{"cluster_min_points": 3}');
  perform pg_temp.assert_eq('minpoints 3, min_current 4', pg_temp.hot('minpts.c01'), null::jsonb);
  perform pg_temp.run('{"cluster_min_points": 3, "min_current_count": 3}');
  h := pg_temp.hot('minpts.c01');
  perform pg_temp.assert_eq('minpoints 3, min_current 3', pg_temp.members(h), pg_temp.names('minpts.%'));
  perform pg_temp.assert_eq('minpoints 3: OTHER now clusters alone',
    pg_temp.members(pg_temp.hot('mixed_ot.c01')), pg_temp.names('mixed_ot.%'));

  -- Thresholds.
  perform pg_temp.run('{"trend_thresholds_percent": {"MEDIUM": 30, "HIGH": 100, "CRITICAL": 200}}');
  perform pg_temp.assert_eq('MEDIUM threshold 30: low33 → MEDIUM', pg_temp.hot('low33.c01') ->> 'severity', 'MEDIUM');
  perform pg_temp.run('{"critical_min_current_count": 4}');
  perform pg_temp.assert_eq('critical_min 4: line → CRITICAL', pg_temp.hot('line.0') ->> 'severity', 'CRITICAL');
  perform pg_temp.run('{"expected_floor": 5}');
  h := pg_temp.hot('line.0');
  perform pg_temp.assert_eq('expected_floor 5: trend 80', (h ->> 'trend_percent')::numeric, 80.0);
  perform pg_temp.assert_eq('expected_floor 5: MEDIUM', h ->> 'severity', 'MEDIUM');
  perform pg_temp.run('{"baseline_divisor": 6}');
  h := pg_temp.hot('high100.c01');
  perform pg_temp.assert_eq('divisor 6: expected 1', (h ->> 'expected_current_count')::numeric, 1.00);
  perform pg_temp.assert_eq('divisor 6: trend 300', (h ->> 'trend_percent')::numeric, 300.0);
  perform pg_temp.assert_eq('divisor 6: capped HIGH', h ->> 'severity', 'HIGH');

  -- Windows.
  perform pg_temp.run('{"input_window_hours": 10}');
  h := pg_temp.hot('window.a');
  perform pg_temp.assert_eq('input 10 h: old issue is baseline', (h ->> 'baseline_issue_count')::int, 1);
  perform pg_temp.assert_eq('input 10 h: window_start',
    (select window_start from public.hotspots where id = (h ->> 'id')::uuid), now() - interval '10 hours');
  perform pg_temp.run('{"input_statuses": ["REPORTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED"]}');
  perform pg_temp.assert_eq('statuses from config', (pg_temp.hot('window.a') ->> 'current_issue_count')::int, 5);
  perform pg_temp.run('{"current_window_hours": 4}');
  h := pg_temp.hot('crit.c01');
  perform pg_temp.assert_eq('current 4 h: baseline issue (3 h 10 min ago) is current',
    array[(h ->> 'current_issue_count')::int, (h ->> 'baseline_issue_count')::int], array[7, 0]);
  perform pg_temp.assert_eq('current 4 h: explanation', h ->> 'explanation',
    '7 DRAINAGE issues within ~300 m in the last 4 h (expected 0.0) — trend +700%.');

  -- Buffer.
  perform pg_temp.run();
  select st_area(geom) into v_area50 from public.hotspots where id = (pg_temp.hot('line.0') ->> 'id')::uuid;
  perform pg_temp.run('{"buffer_m": 100}');
  select st_area(geom) into v_area100 from public.hotspots where id = (pg_temp.hot('line.0') ->> 'id')::uuid;
  perform pg_temp.assert_eq('buffer 100 > buffer 50', v_area100 > v_area50 * 1.5, true);
  perform pg_temp.assert_eq('buffer 100 still covers members',
    (select bool_and(st_covers(hs.geom, i.geom)) from public.hotspots hs
     join public.hotspot_issues hi on hi.hotspot_id = hs.id join public.issues i on i.id = hi.issue_id
     where hs.id = (pg_temp.hot('line.0') ->> 'id')::uuid), true);
end $$;

-- Malformed config → 22023 (→ INTERNAL), nothing changed.
do $$
declare k text; v_before int := (select count(*) from public.hotspots);
begin
  foreach k in array array['input_window_hours', 'input_statuses', 'cluster_srid', 'cluster_eps_m', 'cluster_min_points',
                           'current_window_hours', 'baseline_window_hours', 'baseline_divisor', 'expected_floor',
                           'min_current_count', 'trend_thresholds_percent', 'critical_min_current_count', 'buffer_m'] loop
    begin
      perform public.regenerate_city_pulse(pg_temp.cfg() - k);
      raise exception 'missing % accepted', k;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform pg_temp.run('{"trend_thresholds_percent": {"MEDIUM": 50, "HIGH": 100}}');
    raise exception 'missing CRITICAL threshold accepted';
  exception when sqlstate '22023' then null;
  end;
  perform pg_temp.assert_eq('no rows written by failed runs', (select count(*)::int from public.hotspots), v_before);
end $$;

-- Privileges, definer, search_path, lock ------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array['public.regenerate_city_pulse(jsonb)', 'public.active_hotspots()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is executable by anon/authenticated', f;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f::regprocedure and a.grantee = 0) then
      raise exception '% is executable by PUBLIC', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% is not executable by service_role', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception '% is not security definer', f;
    end if;
    perform pg_temp.assert_eq(f || ' search_path',
      (select proconfig from pg_proc where oid = f::regprocedure), array['search_path=public, extensions']);
  end loop;
  perform pg_temp.assert_eq('active_hotspots is stable',
    (select provolatile from pg_proc where oid = 'public.active_hotspots()'::regprocedure), 's'::"char");
  -- 02 §6.8: the first statement of the body (after comments) takes the transaction-level lock.
  perform pg_temp.assert_eq('lock is the first statement',
    (select ltrim(regexp_replace(split_part(prosrc, E'\nbegin\n', 2), E'^(\\s*--[^\\n]*\\n)*', ''))
              like 'perform pg_advisory_xact_lock(hashtext(''city_pulse''));%'
     from pg_proc where oid = 'public.regenerate_city_pulse(jsonb)'::regprocedure), true);
end $$;

-- The routes call as service_role; the transaction-level advisory lock is then held until commit.
set local role service_role;
do $$ begin
  perform pg_temp.assert_eq('runs as service_role', public.regenerate_city_pulse(pg_temp.cfg()) ? 'hotspots', true);
end $$;
reset role;
do $$ begin
  perform pg_temp.assert_eq('advisory xact lock on hashtext(''city_pulse'') held by this transaction',
    (select count(*)::int from pg_locks
     where locktype = 'advisory' and pid = pg_backend_pid() and granted and mode = 'ExclusiveLock'
       and ((classid::bigint << 32) | objid::bigint) = hashtext('city_pulse')::bigint), 1);
end $$;

-- anon cannot call either function.
set local role anon;
do $$ begin
  begin
    perform public.active_hotspots();
    raise exception 'anon executed active_hotspots';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.regenerate_city_pulse('{}');
    raise exception 'anon executed regenerate_city_pulse';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;

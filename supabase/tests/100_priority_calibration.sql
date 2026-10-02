-- Recommended-priority demo calibration (02 §5.10) — a regression test of all three rows, through
-- the real write path: create_report + add_supporting_report (as the citizen routes call them) and
-- authority_queue(PRIORITY_CONFIG).
-- Uses the seeded "Demo arterial road" zone (risk 80) that contains DEMO_SPOT (02 §14). Under
-- SKIP_SEED no zone exists, so the test creates its own 80 zone around DEMO_SPOT; it passes either way.
-- One transaction, rolled back. now() is fixed, so a fresh issue's age is 0; factors and scores are
-- still compared with a 0.011 tolerance (age drift), labels and severity sources exactly.
--
--   citizen C1 / C2 (anonymous-style, no public.users row)  00000000-0000-4000-8000-00000000100{1,2}
begin;

create function pg_temp.assert_eq(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception '%: expected % got %', p_label, p_want, p_got; end if;
end $$;
grant execute on function pg_temp.assert_eq(text, anyelement, anyelement) to public;

create function pg_temp.assert_near(p_label text, p_got numeric, p_want numeric)
returns void language plpgsql as $$
begin
  if p_got is null or abs(p_got - p_want) >= 0.011 then
    raise exception '%: expected % (±0.01) got %', p_label, p_want, p_got;
  end if;
end $$;
grant execute on function pg_temp.assert_near(text, numeric, numeric) to public;

-- PRIORITY_CONFIG (src/config/civic.ts), as the queue route passes it.
create function pg_temp.pcfg() returns jsonb language sql as $$
  select jsonb_build_object(
    'weights', '{"severity": 0.35, "support": 0.2, "age": 0.15, "location_risk": 0.2, "recurrence": 0.1}'::jsonb,
    'severity_values', '{"LOW": 25, "MEDIUM": 50, "HIGH": 75, "CRITICAL": 100}'::jsonb,
    'default_severity', 'MEDIUM',
    'factor_max', 100,
    'support_multiplier', 25,
    'age_full_hours', 168,
    'default_location_risk', 25,
    'recurrence_window_days', 90,
    'recurrence_points_per_issue', 50,
    'recurrence_radius_m_by_category', '{"STREETLIGHT": 30, "POTHOLE": 50, "FOOTPATH": 50, "PUBLIC_PROPERTY": 50,
      "OTHER": 50, "GARBAGE": 75, "WATER_LEAK": 75, "DRAINAGE": 150, "WATERLOGGING": 150}'::jsonb,
    'label_thresholds', '{"MEDIUM": 25, "HIGH": 40, "CRITICAL": 55}'::jsonb,
    'queue_statuses', '["REPORTED", "ASSIGNED", "IN_PROGRESS"]'::jsonb)
$$;
grant execute on function pg_temp.pcfg() to public;

-- RATE_LIMIT_CONFIG + DUPLICATE_CONFIG.compatible_families, as the report routes pass it.
create function pg_temp.rcfg() returns jsonb language sql as $$
  select jsonb_build_object('window_hours', 1, 'max_reports_per_user', 5, 'max_reports_per_ip_hash', 100,
                            'compatible_families', '[["DRAINAGE", "WATERLOGGING", "WATER_LEAK"]]'::jsonb)
$$;
grant execute on function pg_temp.rcfg() to public;

-- One issue's queue row (looked up in the full, unfiltered queue).
create function pg_temp.row_of(p_issue_id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.authority_queue(pg_temp.pcfg(), '{}')) e where (e ->> 'id')::uuid = p_issue_id
$$;
grant execute on function pg_temp.row_of(uuid) to public;

create function pg_temp.check_row(p_case text, p_row jsonb, p_source text, p_severity numeric, p_support numeric,
                                  p_age numeric, p_risk numeric, p_recurrence numeric, p_score numeric, p_label text)
returns void language plpgsql as $$
begin
  if p_row is null then raise exception '%: issue missing from the queue', p_case; end if;
  perform pg_temp.assert_eq(p_case || ': severity_source', p_row ->> 'severity_source', p_source);
  perform pg_temp.assert_near(p_case || ': severity', (p_row -> 'factors' ->> 'severity')::numeric, p_severity);
  perform pg_temp.assert_near(p_case || ': support', (p_row -> 'factors' ->> 'support')::numeric, p_support);
  perform pg_temp.assert_near(p_case || ': age', (p_row -> 'factors' ->> 'age')::numeric, p_age);
  perform pg_temp.assert_near(p_case || ': location_risk', (p_row -> 'factors' ->> 'location_risk')::numeric, p_risk);
  perform pg_temp.assert_near(p_case || ': recurrence', (p_row -> 'factors' ->> 'recurrence')::numeric, p_recurrence);
  perform pg_temp.assert_near(p_case || ': score', (p_row ->> 'score')::numeric, p_score);
  perform pg_temp.assert_eq(p_case || ': label', p_row ->> 'label', p_label);
end $$;
grant execute on function pg_temp.check_row(text, jsonb, text, numeric, numeric, numeric, numeric, numeric, numeric, text) to public;

-- Fixtures (superuser) ---------------------------------------------------------------------------
-- DEMO_SPOT (src/config/civic.ts) and a generic spot far from every zone and every seeded issue.
create temp table t_spot (name text primary key, lat float8, lng float8, g geography);
insert into t_spot values
  ('demo',    19.0178, 72.8478, st_setsrid(st_makepoint(72.8478, 19.0178), 4326)::geography),
  ('generic', 19.2300, 72.9800, st_setsrid(st_makepoint(72.9800, 19.2300), 4326)::geography);
grant select on t_spot to public;

-- Without the seed there is no zone: add the 80 zone the seed would have (02 §14).
insert into public.risk_zones (name, risk_value, reason, geom)
select 'Test 100 demo zone', 80, 'SKIP_SEED stand-in for "Demo arterial road"',
       st_buffer(s.g, 30)::geography(Polygon, 4326)
from t_spot s
where s.name = 'demo'
  and not exists (select 1 from public.risk_zones z where st_intersects(z.geom, s.g));

-- Preconditions of §5.10.
do $$ begin
  perform pg_temp.assert_eq('DEMO_SPOT location risk',
    (select max(z.risk_value) from public.risk_zones z, t_spot s where s.name = 'demo' and st_intersects(z.geom, s.g)), 80);
  perform pg_temp.assert_eq('no resolved pothole within 50 m of DEMO_SPOT in 90 days',
    (select count(*)::int from public.issues i, t_spot s
     where s.name = 'demo' and i.status = 'RESOLVED' and i.category = 'POTHOLE'
       and i.resolved_at >= now() - interval '90 days' and st_dwithin(i.geom, s.g, 50)), 0);
  perform pg_temp.assert_eq('generic spot outside every zone',
    (select count(*)::int from public.risk_zones z, t_spot s where s.name = 'generic' and st_intersects(z.geom, s.g)), 0);
  perform pg_temp.assert_eq('no resolved OTHER issue near the generic spot',
    (select count(*)::int from public.issues i, t_spot s
     where s.name = 'generic' and i.status = 'RESOLVED' and i.category = 'OTHER' and st_dwithin(i.geom, s.g, 1000)), 0);
end $$;

-- Each citizen's uploaded photo in report-photos.
insert into storage.objects (bucket_id, name) values
  ('report-photos', '00000000-0000-4000-8000-000000001001/00000000-0000-4000-8000-000000000100.jpg'),
  ('report-photos', '00000000-0000-4000-8000-000000001001/00000000-0000-4000-8000-000000000101.jpg'),
  ('report-photos', '00000000-0000-4000-8000-000000001002/00000000-0000-4000-8000-000000000100.jpg');

-- The three rows (called as service_role, like the routes) ----------------------------------------
create temp table t_ids (name text primary key, id uuid);
grant select, insert on t_ids to public;

set local role service_role;
do $$
declare v_demo uuid; v_generic uuid; v_res jsonb;
begin
  -- Row 1: demo pothole, first report, citizen picks HIGH.
  v_res := public.create_report('00000000-0000-4000-8000-000000001001', null, 'POTHOLE', 'HIGH',
                                'Deep pothole in the left lane',
                                '00000000-0000-4000-8000-000000001001/00000000-0000-4000-8000-000000000100.jpg',
                                (select lat from t_spot where name = 'demo'), (select lng from t_spot where name = 'demo'),
                                pg_temp.rcfg());
  v_demo := (v_res ->> 'issue_id')::uuid;
  insert into t_ids values ('demo', v_demo);
  perform pg_temp.check_row('row 1 (1 reporter)', pg_temp.row_of(v_demo), 'CITIZEN', 75, 25.00, 0.00, 80, 0, 47.25, 'HIGH');
  perform pg_temp.assert_eq('row 1: effective severity', pg_temp.row_of(v_demo) ->> 'effective_severity', 'HIGH');
  perform pg_temp.assert_eq('row 1: recurrence_count', (pg_temp.row_of(v_demo) ->> 'recurrence_count')::int, 0);

  -- The same citizen again does not add support.
  perform public.add_supporting_report('00000000-0000-4000-8000-000000001001', null, v_demo, 'POTHOLE', null, 'still there',
                                       '00000000-0000-4000-8000-000000001001/00000000-0000-4000-8000-000000000101.jpg',
                                       19.01781, 72.84781, pg_temp.rcfg());
  perform pg_temp.check_row('row 1 (same reporter twice)', pg_temp.row_of(v_demo), 'CITIZEN', 75, 25.00, 0.00, 80, 0, 47.25, 'HIGH');

  -- Row 2: a second, distinct citizen attaches.
  perform public.add_supporting_report('00000000-0000-4000-8000-000000001002', null, v_demo, 'POTHOLE', 'MEDIUM', 'same here',
                                       '00000000-0000-4000-8000-000000001002/00000000-0000-4000-8000-000000000100.jpg',
                                       19.01779, 72.84779, pg_temp.rcfg());
  perform pg_temp.check_row('row 2 (2 reporters)', pg_temp.row_of(v_demo), 'CITIZEN', 75, 39.62, 0.00, 80, 0, 50.17, 'HIGH');
  perform pg_temp.assert_eq('row 2: counts',
    (pg_temp.row_of(v_demo) ->> 'report_count') || '/' || (pg_temp.row_of(v_demo) ->> 'distinct_reporter_count'), '3/2');
  perform pg_temp.assert_eq('row 2: a supporter''s severity does not change the issue''s',
    pg_temp.row_of(v_demo) ->> 'effective_severity', 'HIGH');

  -- Row 3: generic new report, no severity, outside every zone.
  v_res := public.create_report('00000000-0000-4000-8000-000000001002', null, 'OTHER', null,
                                'Broken bench',
                                '00000000-0000-4000-8000-000000001002/00000000-0000-4000-8000-000000000100.jpg',
                                (select lat from t_spot where name = 'generic'), (select lng from t_spot where name = 'generic'),
                                pg_temp.rcfg());
  v_generic := (v_res ->> 'issue_id')::uuid;
  insert into t_ids values ('generic', v_generic);
  perform pg_temp.check_row('row 3 (generic)', pg_temp.row_of(v_generic), 'DEFAULT', 50, 25.00, 0.00, 25, 0, 27.50, 'MEDIUM');
  perform pg_temp.assert_eq('row 3: effective severity', pg_temp.row_of(v_generic) ->> 'effective_severity', 'MEDIUM');
end $$;
reset role;

-- Print the computed rows (visible with psql output; the assertions above are what count).
select t.name, r -> 'factors' as factors, r ->> 'score' as score, r ->> 'label' as label, r ->> 'severity_source' as source
from t_ids t, lateral (select pg_temp.row_of(t.id) as r) x
order by t.name;

rollback;

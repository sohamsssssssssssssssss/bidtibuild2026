-- City Pulse on the seed (02 §6, §14; 06 rule 3): the real engine on the seeded scenario produces
-- exactly one CRITICAL DRAINAGE hotspot. Requires supabase/seed.sql (the file name contains "seed",
-- so SKIP_SEED=1 skips it). Runs regenerate_city_pulse with CITY_PULSE_CONFIG, then rolls back.
begin;

create function pg_temp.assert_eq(p_label text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception '%: expected % got %', p_label, p_want, p_got; end if;
end $$;
grant execute on function pg_temp.assert_eq(text, anyelement, anyelement) to public;

create temp table t_res (res jsonb);
grant select, insert on t_res to public;

-- As the routes call it: service_role, CITY_PULSE_CONFIG (src/config/civic.ts).
set local role service_role;
insert into t_res
select public.regenerate_city_pulse('{
  "input_window_hours": 8,
  "input_statuses": ["REPORTED", "ASSIGNED", "IN_PROGRESS"],
  "cluster_srid": 32643,
  "cluster_eps_m": 300,
  "cluster_min_points": 4,
  "current_window_hours": 2,
  "baseline_window_hours": 6,
  "baseline_divisor": 3,
  "expected_floor": 1,
  "min_current_count": 4,
  "trend_thresholds_percent": {"MEDIUM": 50, "HIGH": 100, "CRITICAL": 200},
  "critical_min_current_count": 6,
  "buffer_m": 50
}'::jsonb);
reset role;

do $$
declare
  v_res jsonb := (select res from t_res);
  h jsonb;
  v_members uuid[] := array[
    '5eed1000-0000-4000-8000-000000000101', '5eed1000-0000-4000-8000-000000000102',
    '5eed1000-0000-4000-8000-000000000103', '5eed1000-0000-4000-8000-000000000104',
    '5eed1000-0000-4000-8000-000000000105', '5eed1000-0000-4000-8000-000000000106',
    '5eed1000-0000-4000-8000-000000000107']::uuid[];
  v_id uuid;
begin
  perform pg_temp.assert_eq('one hotspot returned', jsonb_array_length(v_res -> 'hotspots'), 1);
  perform pg_temp.assert_eq('one active hotspot row', (select count(*)::int from public.hotspots where active), 1);
  perform pg_temp.assert_eq('returned set = active_hotspots()', v_res -> 'hotspots', public.active_hotspots());

  h := v_res -> 'hotspots' -> 0;
  v_id := (h ->> 'id')::uuid;
  perform pg_temp.assert_eq('severity', h ->> 'severity', 'CRITICAL');
  perform pg_temp.assert_eq('category', h ->> 'category', 'DRAINAGE');
  perform pg_temp.assert_eq('current', (h ->> 'current_issue_count')::int, 6);
  perform pg_temp.assert_eq('baseline', (h ->> 'baseline_issue_count')::int, 1);
  perform pg_temp.assert_eq('expected', h -> 'expected_current_count', '0.33'::jsonb);
  perform pg_temp.assert_eq('trend', h -> 'trend_percent', '566.7'::jsonb);
  perform pg_temp.assert_eq('explanation', h ->> 'explanation',
    '6 DRAINAGE issues within ~300 m in the last 2 h (expected 0.3) — trend +566%.');
  perform pg_temp.assert_eq('members (hotspot_issues)',
    (select array_agg(issue_id order by issue_id) from public.hotspot_issues where hotspot_id = v_id), v_members);
  perform pg_temp.assert_eq('member_issue_ids',
    (select array_agg(m::uuid order by m) from jsonb_array_elements_text(h -> 'member_issue_ids') m), v_members);

  perform pg_temp.assert_eq('geometry is a valid Polygon',
    (select st_geometrytype(geom::geometry) = 'ST_Polygon' and st_isvalid(geom::geometry)
     from public.hotspots where id = v_id), true);
  perform pg_temp.assert_eq('GeoJSON Polygon', h -> 'geometry' ->> 'type', 'Polygon');
  perform pg_temp.assert_eq('covers every member',
    (select bool_and(st_covers(hs.geom, i.geom)) from public.hotspots hs, public.issues i
     where hs.id = v_id and i.id = any (v_members)), true);
  -- DEMO_SPOT (src/config/civic.ts) is > 5 km away (02 §14).
  perform pg_temp.assert_eq('far from DEMO_SPOT',
    (select not st_dwithin(geom, st_setsrid(st_makepoint(72.8478, 19.0178), 4326)::geography, 5000)
     from public.hotspots where id = v_id), true);
end $$;

rollback;

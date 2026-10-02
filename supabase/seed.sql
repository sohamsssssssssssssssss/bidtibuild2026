-- CivicPulse AI — demo seed (02 §14). Applied by `supabase db reset` after the migrations, and by
-- `npm run db:test` (scripts/db-test/run.sh) on the local harness.
--
-- Rules this file follows:
--   * Every timestamp is relative to now() (one shared clock, `seed_clock`, so the file is
--     consistent whether or not the runner wraps it in a transaction).
--   * Every seeded issue has is_seed = true (06 rule 2: the UI shows a "demo data" badge).
--   * Issues only — never hotspot rows (06 rule 3). City Pulse is computed by the real engine
--     (`regenerate_city_pulse`, called by `npm run demo:reset`).
--   * issue_events is append-only (even for superusers), so events are INSERTed once, in
--     chronological order, and never touched again.
--   * Photos: report and evidence image_path values follow the `{uid}/{uuid}.jpg` convention
--     (02 §10.2) but NO objects are uploaded to storage. The UI must treat a missing photo as
--     "photo unavailable" instead of failing.
--
-- Fixed uuids (all valid RFC 4122 v4 shape, prefix 5eed…), handy for tests and routes:
--   departments      5eedde00-0000-4000-8000-00000000000{1..5}   (see below)
--   seed authority   5eeda000-0000-4000-8000-000000000001
--   demo reporters   5eedc000-0000-4000-8000-0000000000NN        (NN = 01..12)
--   issues           5eed1000-0000-4000-8000-0000000000NN        (NN = 01..32, normal issues)
--                    5eed1000-0000-4000-8000-000000000101..107   (City Pulse scenario)
--   reports          5eed2000-0000-4000-8000-000000000NNN        (numbered by created_at)
--   evidence         5eedee00-0000-4000-8000-0000000000NN        (NN = issue number)
--
-- Geography (02 §12, civic.ts):
--   DEMO_SPOT            lat 19.0178, lng 72.8478 (Dadar, on an arterial road)
--   City Pulse centre    lat 19.0728, lng 72.8826 (Kurla), ~7 km from DEMO_SPOT
--   Nothing is seeded within 150 m of DEMO_SPOT and no pothole within 300 m (02 §5.10, §14).

set search_path = public, extensions;

create temp table seed_clock as select now() as t0;

-- ---------------------------------------------------------------------------------------------
-- 1. Departments (02 §8: sla_hours default 72)
-- ---------------------------------------------------------------------------------------------
-- default_categories drives the assignment suggestion.
--   * PUBLIC_PROPERTY goes to Roads: railings, dividers, benches and bus shelters sit on the
--     road right-of-way, which Roads maintains.
--   * OTHER is deliberately in no department's defaults: there is no honest suggestion for it,
--     so the authority picks the department by hand.
insert into public.departments (id, name, sla_hours, default_categories) values
  ('5eedde00-0000-4000-8000-000000000001', 'Roads',                72, '{POTHOLE,FOOTPATH,PUBLIC_PROPERTY}'),
  ('5eedde00-0000-4000-8000-000000000002', 'Street Lighting',      72, '{STREETLIGHT}'),
  ('5eedde00-0000-4000-8000-000000000003', 'Solid Waste',          72, '{GARBAGE}'),
  ('5eedde00-0000-4000-8000-000000000004', 'Water Supply',         72, '{WATER_LEAK}'),
  ('5eedde00-0000-4000-8000-000000000005', 'Storm Water Drainage', 72, '{DRAINAGE,WATERLOGGING}');

-- ---------------------------------------------------------------------------------------------
-- 2. Seed authority — the actor of seeded authority events and uploader of seeded evidence
-- ---------------------------------------------------------------------------------------------
-- resolution_evidence.uploaded_by → users → auth.users, so the seed needs an auth user. It has no
-- password and no identity, so it cannot log in. Real authority accounts are created by
-- `npm run demo:reset` through the Auth admin API (02 §7.2).
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '5eeda000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'seed-authority@civicpulse.invalid',
       '{"provider":"email","providers":["email"]}', '{}',
       t0 - interval '30 days', t0 - interval '30 days'
from seed_clock;

-- GoTrue scans these text columns as non-null strings; a NULL makes the Auth admin API
-- (e.g. listUsers, used by demo:reset) fail with "converting NULL to string". Real Supabase
-- creates them nullable, so blank them where they exist. (The test harness shim lacks them.)
do $$
declare c text;
begin
  for c in
    select column_name from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and data_type in ('character varying', 'text')
      and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new',
                          'email_change_token_current', 'email_change', 'phone_change',
                          'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %I = '''' where id = %L and %I is null',
                   c, '5eeda000-0000-4000-8000-000000000001', c);
  end loop;
end $$;

insert into public.users (id, name, email, role, created_at)
select '5eeda000-0000-4000-8000-000000000001', 'Seed Authority (demo data)',
       'seed-authority@civicpulse.invalid', 'AUTHORITY', t0 - interval '30 days'
from seed_clock;

-- ---------------------------------------------------------------------------------------------
-- 3. Risk zones (02 §5.7, §5.10)
-- ---------------------------------------------------------------------------------------------
-- "Demo arterial road": a ~1.06 km stretch of the road through DEMO_SPOT (its midpoint), buffered
-- 30 m each side → a ~60 m wide corridor. DEMO_SPOT must sit in this zone and in no other, so its
-- location risk is exactly 80 (02 §5.10). The other zones are > 1 km away from DEMO_SPOT.
insert into public.risk_zones (id, name, risk_value, reason, geom) values
  ('5eed3000-0000-4000-8000-000000000001', 'Demo arterial road', 80,
   'Busy arterial road: heavy two-wheeler and bus traffic, frequent night-time accidents.',
   ST_Buffer('SRID=4326;LINESTRING(72.8462 19.0133, 72.8494 19.0223)'::geography, 30)::geography(Polygon, 4326)),
  ('5eed3000-0000-4000-8000-000000000002', 'School zone (Matunga)', 60,
   'Several schools; heavy pedestrian traffic of children at opening and closing times.',
   ST_Buffer('SRID=4326;POINT(72.8555 19.0280)'::geography, 150)::geography(Polygon, 4326)),
  ('5eed3000-0000-4000-8000-000000000003', 'Hospital zone (Parel)', 70,
   'Major hospitals; ambulance access routes.',
   ST_Buffer('SRID=4326;POINT(72.8420 19.0025)'::geography, 200)::geography(Polygon, 4326));

-- ---------------------------------------------------------------------------------------------
-- 4. Issue staging
-- ---------------------------------------------------------------------------------------------
-- Each issue is one row here plus optional lifecycle rows below. Status is DERIVED from the
-- lifecycle (merged > rejected > resolved > started > assigned > reported), so status, columns
-- and events cannot disagree. A check block (§6) validates ordering before anything is written.
--
-- reporter = demo reporter number (uuid 5eedc000-0000-4000-8000-0000000000NN).
-- The first report is at the issue's own location and time, with its severity and description.
create temp table seed_issue (
  n           int primary key,
  category    public.issue_category not null,
  lat         float8 not null,
  lng         float8 not null,
  created_ago interval not null,
  reporter    int not null,
  severity    public.level,
  description text not null
);

-- 4a. Normal issues across the Mumbai demo area. Only #4, #8, #11 are younger than 8 h, each in a
-- different category, so none can form a City Pulse cluster (minpoints 4).
insert into seed_issue (n, category, lat, lng, created_ago, reporter, severity, description) values
  ( 1, 'POTHOLE',         18.9965, 72.8305, '19 days',          1, 'HIGH',     'Deep pothole in the left lane outside the old mill compound. Two-wheelers swerve into traffic to avoid it.'),
  ( 2, 'POTHOLE',         18.9968, 72.8307, '2 days 5 hours',   2, 'MEDIUM',   'Pothole has opened up again at the same spot that was patched a couple of weeks ago.'),
  ( 3, 'POTHOLE',         19.0430, 72.8625, '6 days',           4, 'HIGH',     'Cluster of potholes at the Sion Circle signal, filled with water after the rain.'),
  ( 4, 'POTHOLE',         19.0625, 72.8995, '1 hour 20 minutes',7, null,       'Fresh pothole near the bus stop after last night''s rain.'),
  ( 5, 'POTHOLE',         19.1135, 72.8700, '9 days',           8, 'MEDIUM',   'Large pothole at the Marol Naka turn. Bus wheels drop into it.'),
  ( 6, 'POTHOLE',         19.0175, 72.8660, '13 days',         10, 'HIGH',     'Two deep potholes on the service road near the monorail station.'),
  ( 7, 'STREETLIGHT',     19.0275, 72.8385, '4 days',          11, 'MEDIUM',   'Three streetlights out along the west side of the park. Very dark after 8 pm.'),
  ( 8, 'STREETLIGHT',     19.0560, 72.8320, '5 hours',         12, null,       'Streetlight flickering on and off outside the building gate.'),
  ( 9, 'STREETLIGHT',     19.0790, 72.9110, '16 days',          1, 'LOW',      'Lamp post light stays on through the day.'),
  (10, 'STREETLIGHT',     19.1000, 72.8520, '2 days',           2, 'HIGH',     'The whole stretch under the flyover is dark. People avoid walking here at night.'),
  (11, 'GARBAGE',         18.9790, 72.8335, '3 hours',          4, 'MEDIUM',   'Garbage pile spilling onto the road next to the vegetable market.'),
  (12, 'GARBAGE',         19.0405, 72.8535, '3 days',           5, 'HIGH',     'Community bin overflowing, not cleared for three days. Strong smell.'),
  (13, 'GARBAGE',         19.0750, 72.8620, '8 days',           9, 'MEDIUM',   'Construction debris dumped on the footpath.'),
  (14, 'GARBAGE',         19.0810, 72.8385, '1 day 3 hours',   10, null,       'Plastic waste dumped behind the bus depot wall.'),
  (15, 'GARBAGE',         19.0400, 72.8410, '11 days',         11, 'LOW',      'Garbage bags left near the station entrance every night.'),
  (16, 'WATER_LEAK',      19.0035, 72.8425, '2 days 8 hours',  12, 'HIGH',     'Water main leaking at the road edge since morning. Clean water running into the gutter.'),
  (17, 'WATER_LEAK',      19.0280, 72.8555, '5 days',           2, 'MEDIUM',   'Pipe leaking under the footpath near the school gate.'),
  (18, 'WATER_LEAK',      19.0860, 72.9080, '20 hours',         3, 'LOW',      'Small continuous leak from a valve chamber.'),
  (19, 'WATER_LEAK',      18.9695, 72.8200, '7 days',           4, 'MEDIUM',   'Leaking connection outside the building. Water pooling on the road.'),
  (20, 'DRAINAGE',        19.0110, 72.8430, '10 days',          5, 'HIGH',     'Storm drain grating blocked with silt. Water backs up at every shower.'),
  (21, 'DRAINAGE',        19.0520, 72.8730, '3 days 6 hours',   6, 'MEDIUM',   'Drain cover missing near the station road. Open hole at the road edge.'),
  (22, 'DRAINAGE',        19.0790, 72.8970, '18 days',          7, 'MEDIUM',   'Nullah overflowing into the lane.'),
  (23, 'WATERLOGGING',    19.0100, 72.8420, '1 day 10 hours',   8, 'HIGH',     'Knee-deep water at the junction after the evening downpour.'),
  (24, 'WATERLOGGING',    19.1185, 72.8465, '4 days 2 hours',  11, 'CRITICAL', 'Subway completely flooded, vehicles stuck inside.'),
  (25, 'WATERLOGGING',    19.0305, 72.8570, '15 days',         12, 'MEDIUM',   'Water collects under the bridge for hours after rain.'),
  (26, 'FOOTPATH',        19.0150, 72.8300, '6 days',           1, 'MEDIUM',   'Broken paver blocks and an open gap on the footpath. Elderly residents tripping.'),
  (27, 'FOOTPATH',        19.0640, 72.8650, '21 days',          2, 'LOW',      'Footpath slab tilted and cracked near the bus stop.'),
  (28, 'PUBLIC_PROPERTY', 18.9535, 72.8290, '2 days 20 hours',  3, 'LOW',      'Bus shelter roof panel hanging loose.'),
  (29, 'PUBLIC_PROPERTY', 19.1030, 72.8880, '9 days',           4, 'MEDIUM',   'Road divider railing broken and bent into the lane.'),
  (30, 'OTHER',           19.1110, 72.9100, '1 day 18 hours',   5, null,       'Fallen tree branch blocking half the lane.'),
  (31, 'POTHOLE',         19.0085, 72.8195, '12 days',          6, 'MEDIUM',   'Pothole near the bus stop at the naka.'),
  (32, 'POTHOLE',         19.0086, 72.8197, '9 days',           8, 'HIGH',     'Big pothole right at the bus stop. Buses splash pedestrians waiting there.');

-- 4b. City Pulse scenario (02 §6, §14): DRAINAGE issues around the Kurla centre
-- (lat 19.0728, lng 72.8826). Every point is within ~110 m of the centre, so every pairwise
-- distance is < 300 m and DBSCAN (eps 300 m, minpoints 4, EPSG:32643) puts them in one cluster.
--   * 101–106: current window (last 2 h), created 3–30 min ago → current_count = 6
--   * 107:     baseline window (2–8 h ago)                         → baseline_count = 1
-- expected = 1/3, trend = (6 - 0.33) / max(0.33, 1) * 100 ≈ +567 % and current ≥ 6 → CRITICAL.
-- The oldest current issue is 30 min old, so the hotspot stays CRITICAL for ~90 min after
-- demo:reset (and 107 stays in the baseline window for ~3 h 50 min). Reset shortly before presenting.
-- (offsets from the centre: dx east / dy north in metres, lat = 19.0728 + dy/111320,
--  lng = 72.8826 + dx/105210)
insert into seed_issue (n, category, lat, lng, created_ago, reporter, severity, description) values
  (101, 'DRAINAGE', 19.07316, 72.88184, '30 minutes',  3, 'HIGH',   'Drain overflowing onto the main road after the heavy shower. Water entering shops.'),  -- (-80,  40)
  (102, 'DRAINAGE', 19.07343, 72.88317, '25 minutes',  6, 'MEDIUM', 'Blocked drain outside the school. Dirty water spreading across the lane.'),         -- ( 60,  70)
  (103, 'DRAINAGE', 19.07199, 72.88279, '20 minutes',  9, 'HIGH',   'Sewage-mixed water backing up from the gutter near the market.'),                   -- ( 20, -90)
  (104, 'DRAINAGE', 19.07226, 72.88212, '14 minutes', 10, null,     'Drain chamber cover lifted by water pressure. Water gushing out.'),                -- (-50, -60)
  (105, 'DRAINAGE', 19.07262, 72.88346, '8 minutes',  12, 'MEDIUM', 'Roadside nullah choked with plastic, overflowing near the bus stop.'),              -- ( 90, -20)
  (106, 'DRAINAGE', 19.07370, 72.88250, '3 minutes',   1, 'HIGH',   'Drain overflowing into the housing society compound.'),                             -- (-10, 100)
  (107, 'DRAINAGE', 19.07289, 72.88298, '4 hours 10 minutes', 7, 'MEDIUM', 'Slow-draining gutter, water standing near the corner shop.');                -- ( 40,  10)

-- Supporting reports (another citizen chose "This is the same issue"). Offsets in metres from the
-- issue location; all within the category's duplicate radius (02 §3.2). category defaults to the
-- issue's; #23 shows a compatible-family report (DRAINAGE on a WATERLOGGING issue, 02 §3.4).
create temp table seed_support (
  n           int not null,
  reporter    int not null,
  ago         interval not null,
  dx_m        float8 not null,
  dy_m        float8 not null,
  severity    public.level,
  category    public.issue_category,
  description text not null
);
insert into seed_support (n, reporter, ago, dx_m, dy_m, severity, category, description) values
  ( 2,  3, '1 day 20 hours',   8,  -6, 'HIGH',   null,       'Same pothole, it is getting deeper every day.'),
  ( 3,  5, '5 days 20 hours', 12,  10, 'HIGH',   null,       'Potholes at the signal, a scooter fell here this morning.'),
  ( 3,  6, '4 days',         -15,   5, 'MEDIUM', null,       'Still not fixed, traffic crawling because of these potholes.'),
  ( 5,  9, '8 days 12 hours', -6,  12, 'HIGH',   null,       'Pothole at Marol Naka, very dangerous at night.'),
  (10,  3, '1 day 22 hours',  20,  -8, 'HIGH',   null,       'No lights under the flyover at all.'),
  (12,  6, '2 days 12 hours', 10,   0, 'HIGH',   null,       'Bin overflowing, dogs spreading the garbage across the road.'),
  (12,  7, '1 day 6 hours',   -5,  15, 'MEDIUM', null,       'Garbage still not picked up.'),
  (12,  8, '20 hours',        18,  -9, null,     null,       'The smell is unbearable now.'),
  (16,  1, '2 days 2 hours', -12,   6, 'HIGH',   null,       'Leak is getting worse, road surface washing away.'),
  (23,  9, '1 day 9 hours',   30, -20, 'HIGH',   'DRAINAGE', 'Drain at the junction overflowing, the whole road is under water.'),
  (23, 10, '1 day 6 hours',  -25,  40, 'HIGH',   null,       'Water still standing at the junction, buses diverted.'),
  (31,  7, '10 days',          5,   5, 'MEDIUM', null,       'Pothole at the bus stop is still there.'),
  -- City Pulse: a supporting report never increases the hotspot count (02 §6.1).
  (102, 4, '18 minutes',      15,  -5, 'HIGH',   null,       'Same blocked drain, water now reaching the school gate.');

-- Lifecycle (all `ago` values are before now; the check block enforces the order).
-- Authority priority / severity (set_priority): PRIORITY_SET and/or SEVERITY_CONFIRMED.
create temp table seed_priority (n int primary key, ago interval not null, final_priority public.level, authority_severity public.level);
insert into seed_priority (n, ago, final_priority, authority_severity) values
  ( 1, '18 days 20 hours', 'HIGH',     null),
  ( 3, '5 days 2 hours',   'HIGH',     null),
  (10, '1 day 21 hours',   'HIGH',     'HIGH'),
  (12, '2 days 19 hours',  'MEDIUM',   null),
  (16, '2 days 1 hour',    'HIGH',     null),
  (20, '9 days 21 hours',  'HIGH',     null),
  (23, '1 day 8 hours 30 minutes', 'HIGH', 'CRITICAL'),
  (24, '4 days 1 hour',    'CRITICAL', 'CRITICAL'),
  (107,'3 hours 5 minutes','MEDIUM',   null);

-- Assignment (assign_issue): ASSIGNED, assigned_at, sla_due_at = assigned_at + sla_hours.
-- dept: 1 Roads, 2 Street Lighting, 3 Solid Waste, 4 Water Supply, 5 Storm Water Drainage.
create temp table seed_assign (n int primary key, dept int not null, ago interval not null);
insert into seed_assign (n, dept, ago) values
  ( 1, 1, '18 days 18 hours'), ( 3, 1, '5 days'),          ( 5, 1, '8 days'),
  ( 6, 1, '12 days'),          ( 7, 2, '3 days 20 hours'), ( 9, 2, '15 days'),
  (10, 2, '1 day 20 hours'),   (12, 3, '2 days 18 hours'), (13, 3, '7 days 12 hours'),
  (16, 4, '2 days'),           (17, 4, '4 days 18 hours'), (19, 4, '6 days'),
  (20, 5, '9 days 20 hours'),  (21, 5, '3 days'),          (22, 5, '17 days'),
  (23, 5, '1 day 8 hours'),    (24, 5, '4 days'),          (25, 5, '14 days'),
  (26, 1, '5 days 12 hours'),  (27, 1, '20 days'),         (29, 1, '8 days'),
  (31, 1, '11 days'),
  (101, 5, '12 minutes'),      (107, 5, '3 hours');

-- Start work (transition_issue → IN_PROGRESS): STATUS_CHANGED.
create temp table seed_start (n int primary key, ago interval not null);
insert into seed_start (n, ago) values
  ( 1, '16 days'),        ( 5, '2 days'),         ( 6, '11 days'),   ( 9, '14 days 20 hours'),
  (10, '1 day'),          (13, '7 days'),         (16, '1 day 12 hours'), (17, '4 days'),
  (20, '9 days'),         (22, '15 days'),        (23, '1 day'),     (25, '13 days'),
  (27, '18 days'),        (29, '6 days'),         (107, '2 hours 30 minutes');

-- Resolve (resolve_issue): resolution_evidence row + RESOLVED + resolved_at.
create temp table seed_resolve (n int primary key, ago interval not null, note text not null);
insert into seed_resolve (n, ago, note) values
  ( 1, '14 days',          'Patched with cold mix and rolled.'),
  ( 6, '9 days',           'Both potholes filled and resurfaced.'),
  ( 9, '12 days',          'Faulty photocell replaced; light now switches off at dawn.'),
  (13, '6 days',           'Debris cleared and the footpath swept.'),
  (17, '3 days',           'Leaking joint replaced and footpath slab restored.'),
  (20, '6 days',           'Drain desilted and grating replaced.'),
  (22, '11 days',          'Nullah cleaned along the lane; outflow restored.'),
  (25, '10 days',          'Drain inlet under the bridge cleared; temporary pump on standby.'),
  (27, '16 days',          'Slab relaid and levelled.');

-- Reject (transition_issue → REJECTED): reason required (02 §4).
create temp table seed_reject (n int primary key, ago interval not null, note text not null);
insert into seed_reject (n, ago, note) values
  (15, '10 days', 'Location is inside railway premises, outside municipal jurisdiction. Forwarded to the railway authority.');

-- Merge (merge_issue, 02 §3.7): the source's reports move to the target; MERGED_INTO on the source,
-- MERGED_FROM on the target. The source is newer than the target, so the target keeps its own
-- first report (and geom). The merged issue itself therefore has no reports left.
create temp table seed_merge (source int primary key, target int not null, ago interval not null, note text);
insert into seed_merge (source, target, ago, note) values
  (32, 31, '8 days 20 hours', 'Same pothole as the existing report at this bus stop.');

-- ---------------------------------------------------------------------------------------------
-- 5. Resolve staging into absolute timestamps and ids
-- ---------------------------------------------------------------------------------------------
create temp table seed_life as
select
  ('5eed1000-0000-4000-8000-' || lpad(i.n::text, 12, '0'))::uuid as id,
  i.n, i.category, i.severity,
  ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326)::geography as geom,
  c.t0 - i.created_ago as created_at,
  ('5eedde00-0000-4000-8000-' || lpad(a.dept::text, 12, '0'))::uuid as department_id,
  c.t0 - a.ago   as assigned_at,
  c.t0 - s.ago   as started_at,
  c.t0 - r.ago   as resolved_at,
  r.note         as resolve_note,
  c.t0 - rj.ago  as rejected_at,
  rj.note        as reject_note,
  ('5eed1000-0000-4000-8000-' || lpad(m.target::text, 12, '0'))::uuid as merged_into,
  m.target       as merged_into_n,
  c.t0 - m.ago   as merged_at,
  m.note         as merge_note,
  c.t0 - p.ago   as priority_at,
  p.final_priority, p.authority_severity,
  case
    when m.source is not null then 'MERGED'
    when rj.n is not null then 'REJECTED'
    when r.n is not null then 'RESOLVED'
    when s.n is not null then 'IN_PROGRESS'
    when a.n is not null then 'ASSIGNED'
    else 'REPORTED'
  end::public.issue_status as status
from seed_issue i
cross join seed_clock c
left join seed_assign a    on a.n = i.n
left join seed_start s     on s.n = i.n
left join seed_resolve r   on r.n = i.n
left join seed_reject rj   on rj.n = i.n
left join seed_merge m     on m.source = i.n
left join seed_priority p  on p.n = i.n;

-- Reports: each issue's first report + supporting reports. `issue_n` is the issue the report was
-- filed on; after a merge it lives on the target (02 §3.7).
create temp table seed_rep as
with all_reports as (
  select i.n as issue_n, i.reporter, i.created_at, i.category, i.severity, i.description,
         i.lat, i.lng, true as is_first
  from (select si.*, c.t0 - si.created_ago as created_at from seed_issue si cross join seed_clock c) i
  union all
  select s.n, s.reporter, c.t0 - s.ago, coalesce(s.category, si.category), s.severity, s.description,
         si.lat + s.dy_m / 111320.0,
         si.lng + s.dx_m / (111320.0 * cos(radians(si.lat))),
         false
  from seed_support s
  join seed_issue si on si.n = s.n
  cross join seed_clock c
)
select
  ('5eed2000-0000-4000-8000-' || lpad((row_number() over (order by ar.created_at, ar.issue_n))::text, 12, '0'))::uuid as id,
  ar.issue_n,
  coalesce(l.merged_into_n, ar.issue_n) as owner_n,
  ('5eedc000-0000-4000-8000-' || lpad(ar.reporter::text, 12, '0'))::uuid as reporter_user_id,
  ar.created_at, ar.category, ar.severity, ar.description, ar.is_first,
  ST_SetSRID(ST_MakePoint(ar.lng, ar.lat), 4326)::geography as geom
from all_reports ar
join seed_life l on l.n = ar.issue_n;

-- ---------------------------------------------------------------------------------------------
-- 6. Sanity checks on the staging data (fail the seed rather than write inconsistent history)
-- ---------------------------------------------------------------------------------------------
do $$
declare bad text;
begin
  -- Lifecycle steps must each follow the previous one and lie in the past.
  select string_agg(n::text, ', ') into bad from seed_life l, seed_clock c where not (
        l.created_at <= c.t0
    and (l.priority_at is null or l.priority_at >  l.created_at)
    and (l.assigned_at is null or (l.assigned_at > l.created_at and (l.priority_at is null or l.assigned_at > l.priority_at)))
    and (l.started_at  is null or (l.assigned_at is not null and l.started_at  > l.assigned_at))
    and (l.resolved_at is null or (l.started_at  is not null and l.resolved_at > l.started_at))
    and (l.rejected_at is null or (l.started_at is null and l.resolved_at is null and l.merged_at is null
                                   and l.rejected_at > coalesce(l.assigned_at, l.priority_at, l.created_at)))
    and (l.merged_at   is null or (l.resolved_at is null and l.rejected_at is null
                                   and l.merged_at > greatest(l.created_at, l.priority_at, l.assigned_at, l.started_at)))
  );
  if bad is not null then raise exception 'seed: lifecycle order wrong for issue(s) %', bad; end if;

  -- Supporting reports must arrive while the issue is open (and after it was created).
  select string_agg(distinct r.issue_n::text, ', ') into bad
  from seed_rep r join seed_life l on l.n = r.issue_n
  where not r.is_first
    and (r.created_at <= l.created_at
         or r.created_at >= coalesce(l.resolved_at, l.rejected_at, l.merged_at, 'infinity'));
  if bad is not null then raise exception 'seed: supporting report outside the open period for issue(s) %', bad; end if;

  -- Merge: target open at merge time and older than the source (no merge chains, 02 §3.7).
  select string_agg(s.n::text, ', ') into bad
  from seed_life s join seed_life t on t.id = s.merged_into
  where t.created_at >= s.created_at
     or t.merged_at is not null
     or coalesce(t.resolved_at, t.rejected_at, 'infinity') <= s.merged_at;
  if bad is not null then raise exception 'seed: bad merge for source issue(s) %', bad; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Write issues, reports, evidence and events
-- ---------------------------------------------------------------------------------------------
insert into public.issues (id, category, status, citizen_severity, authority_severity, final_priority, geom,
                           assigned_department_id, assigned_at, sla_due_at, merged_into_issue_id, is_seed,
                           created_at, updated_at, resolved_at)
select l.id, l.category, l.status, l.severity, l.authority_severity, l.final_priority, l.geom,
       l.department_id, l.assigned_at,
       l.assigned_at + make_interval(hours => d.sla_hours),
       l.merged_into, true,
       l.created_at,
       -- updated_at = the latest change to the issue row (a merge target changes with MERGED_FROM;
       -- supporting reports don't change the issue row).
       greatest(l.created_at, l.priority_at, l.assigned_at, l.started_at, l.resolved_at, l.rejected_at, l.merged_at,
                (select max(s.merged_at) from seed_life s where s.merged_into = l.id)),
       l.resolved_at
from seed_life l
left join public.departments d on d.id = l.department_id
order by l.n;

insert into public.reports (id, issue_id, reporter_user_id, reporter_ip_hash, category, citizen_severity,
                            description, image_path, geom, created_at)
select r.id, l.id, r.reporter_user_id, null, r.category, r.severity, r.description,
       r.reporter_user_id::text || '/' || r.id::text || '.jpg',
       r.geom, r.created_at
from seed_rep r
join seed_life l on l.n = r.owner_n
order by r.created_at;

insert into public.resolution_evidence (id, issue_id, uploaded_by, image_path, note, created_at)
select ('5eedee00-0000-4000-8000-' || lpad(l.n::text, 12, '0'))::uuid,
       l.id, '5eeda000-0000-4000-8000-000000000001',
       '5eeda000-0000-4000-8000-000000000001/' || ('5eedee00-0000-4000-8000-' || lpad(l.n::text, 12, '0')) || '.jpg',
       l.resolve_note, l.resolved_at
from seed_life l
where l.resolved_at is not null;

-- Events, in chronological order per issue. Authority actor = the seed authority; citizen events
-- carry the reporter's uuid (the API sanitises actor ids, 02 §7.4).
insert into public.issue_events (issue_id, actor_user_id, event_type, from_status, to_status, note, metadata, created_at)
select issue_id, actor, event_type, from_status::public.issue_status, to_status::public.issue_status, note, metadata, created_at
from (
  -- CREATED (first report)
  select l.id as issue_id, r.reporter_user_id as actor, 'CREATED' as event_type,
         null as from_status, 'REPORTED' as to_status, null as note,
         jsonb_build_object('report_id', r.id) as metadata, l.created_at
  from seed_life l join seed_rep r on r.issue_n = l.n and r.is_first
  union all
  -- SUPPORT_ADDED (non-status event)
  select l.id, r.reporter_user_id, 'SUPPORT_ADDED', null, null, null,
         jsonb_build_object('report_id', r.id), r.created_at
  from seed_life l join seed_rep r on r.issue_n = l.n and not r.is_first
  union all
  -- SEVERITY_CONFIRMED then PRIORITY_SET (one set_priority call; 1 s apart for a stable order)
  select l.id, '5eeda000-0000-4000-8000-000000000001'::uuid, 'SEVERITY_CONFIRMED', null, null, null,
         jsonb_build_object('authority_severity', l.authority_severity), l.priority_at
  from seed_life l where l.authority_severity is not null
  union all
  select l.id, '5eeda000-0000-4000-8000-000000000001'::uuid, 'PRIORITY_SET', null, null, null,
         jsonb_build_object('final_priority', l.final_priority), l.priority_at + interval '1 second'
  from seed_life l where l.final_priority is not null
  union all
  -- ASSIGNED: REPORTED → ASSIGNED
  select l.id, '5eeda000-0000-4000-8000-000000000001'::uuid, 'ASSIGNED', 'REPORTED', 'ASSIGNED', null,
         jsonb_build_object('department_id', l.department_id), l.assigned_at
  from seed_life l where l.assigned_at is not null
  union all
  -- STATUS_CHANGED: ASSIGNED → IN_PROGRESS
  select l.id, '5eeda000-0000-4000-8000-000000000001'::uuid, 'STATUS_CHANGED', 'ASSIGNED', 'IN_PROGRESS', null,
         '{}'::jsonb, l.started_at
  from seed_life l where l.started_at is not null
  union all
  -- RESOLVED: IN_PROGRESS → RESOLVED (evidence inserted above)
  select l.id, '5eeda000-0000-4000-8000-000000000001'::uuid, 'RESOLVED', 'IN_PROGRESS', 'RESOLVED', l.resolve_note,
         jsonb_build_object('evidence_id', ('5eedee00-0000-4000-8000-' || lpad(l.n::text, 12, '0'))), l.resolved_at
  from seed_life l where l.resolved_at is not null
  union all
  -- REJECTED: REPORTED/ASSIGNED → REJECTED, with the reason as note
  select l.id, '5eeda000-0000-4000-8000-000000000001'::uuid, 'REJECTED',
         case when l.assigned_at is not null then 'ASSIGNED' else 'REPORTED' end, 'REJECTED', l.reject_note,
         '{}'::jsonb, l.rejected_at
  from seed_life l where l.rejected_at is not null
  union all
  -- MERGED_INTO on the source: <status at merge> → MERGED
  select l.id, '5eeda000-0000-4000-8000-000000000001'::uuid, 'MERGED_INTO',
         case when l.started_at is not null then 'IN_PROGRESS'
              when l.assigned_at is not null then 'ASSIGNED' else 'REPORTED' end,
         'MERGED', l.merge_note,
         jsonb_build_object('target_issue_id', l.merged_into,
                            'moved_report_ids', (select jsonb_agg(r.id order by r.created_at) from seed_rep r where r.issue_n = l.n)),
         l.merged_at
  from seed_life l where l.merged_at is not null
  union all
  -- MERGED_FROM on the target (non-status event)
  select l.merged_into, '5eeda000-0000-4000-8000-000000000001'::uuid, 'MERGED_FROM', null, null, l.merge_note,
         jsonb_build_object('source_issue_id', l.id,
                            'moved_report_ids', (select jsonb_agg(r.id order by r.created_at) from seed_rep r where r.issue_n = l.n)),
         l.merged_at
  from seed_life l where l.merged_at is not null
) e
order by created_at, issue_id;

-- ---------------------------------------------------------------------------------------------
-- Clean up the staging tables (temp tables would vanish with the session anyway).
-- ---------------------------------------------------------------------------------------------
drop table seed_merge, seed_reject, seed_resolve, seed_start, seed_assign, seed_priority,
           seed_rep, seed_support, seed_life, seed_issue, seed_clock;

-- CivicPulse AI — Phase 3: duplicates, supporting reports and authority merge (02 §3, §4, §9, §10.2; 04 §3).
--
-- Error convention (04 §3): raise exception using errcode = 'PT<http>', message = '<ERROR_CODES key>',
-- detail = '<reason>'. A missing / malformed p_config key is a programming error: SQLSTATE 22023
-- (the route maps it to INTERNAL). Open statuses = REPORTED, ASSIGNED, IN_PROGRESS (REOPENED is
-- the reopen stretch and not enabled).

-- check_report_input — the input and photo checks shared by create_report and add_supporting_report
-- (02 §10.2 defence in depth). Returns the trimmed description. Raises, in this order:
--   PT403 FORBIDDEN          'actor required'
--   PT400 VALIDATION_FAILED  'category required' / 'description required' / 'invalid location' / 'image_path required'
--   PT403 FORBIDDEN          'image_path is not in the caller''s folder'
--   PT400 VALIDATION_FAILED  'photo not found in storage'   (no such object in report-photos)
create function public.check_report_input(
  p_actor_id uuid,
  p_category public.issue_category,
  p_description text,
  p_image_path text,
  p_lat double precision,
  p_lng double precision
)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  -- Trim all surrounding whitespace (like Zod's .trim()), not only spaces.
  v_description text := regexp_replace(p_description, '^\s+|\s+$', '', 'g');
begin
  if p_actor_id is null then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'actor required';
  end if;

  if p_category is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'category required';
  end if;
  if v_description is null or v_description = '' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'description required';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'invalid location';
  end if;
  if p_image_path is null or p_image_path = '' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'image_path required';
  end if;

  if not starts_with(p_image_path, p_actor_id::text || '/') then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'image_path is not in the caller''s folder';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'report-photos' and o.name = p_image_path
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'photo not found in storage';
  end if;

  return v_description;
end;
$$;

revoke all on function public.check_report_input(uuid, public.issue_category, text, text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.check_report_input(uuid, public.issue_category, text, text, double precision, double precision) to service_role;

-- create_report — unchanged behaviour (20261002000800); its checks now come from check_report_input.
create or replace function public.create_report(
  p_actor_id uuid,
  p_ip_hash text,
  p_category public.issue_category,
  p_citizen_severity public.level,
  p_description text,
  p_image_path text,
  p_lat double precision,
  p_lng double precision,
  p_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_description text;
  v_geom        geography;
  v_issue_id    uuid;
  v_report_id   uuid;
begin
  v_description := public.check_report_input(p_actor_id, p_category, p_description, p_image_path, p_lat, p_lng);
  perform public.check_report_rate_limit(p_actor_id, p_ip_hash, p_config);

  v_geom := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  insert into public.issues (category, status, citizen_severity, geom)
  values (p_category, 'REPORTED', p_citizen_severity, v_geom)
  returning id into v_issue_id;

  insert into public.reports (issue_id, reporter_user_id, reporter_ip_hash, category, citizen_severity,
                              description, image_path, geom)
  values (v_issue_id, p_actor_id, p_ip_hash, p_category, p_citizen_severity,
          v_description, p_image_path, v_geom)
  returning id into v_report_id;

  insert into public.issue_events (issue_id, actor_user_id, event_type, from_status, to_status)
  values (v_issue_id, p_actor_id, 'CREATED', null, 'REPORTED');

  return jsonb_build_object('issue_id', v_issue_id, 'report_id', v_report_id);
end;
$$;

revoke all on function public.create_report(uuid, text, public.issue_category, public.level, text, text, double precision, double precision, jsonb) from public, anon, authenticated;
grant execute on function public.create_report(uuid, text, public.issue_category, public.level, text, text, double precision, double precision, jsonb) to service_role;

-- category_family_mates — every category that shares a compatible family with p_category, read from
-- p_families = DUPLICATE_CONFIG.compatible_families (a jsonb array of text arrays, 02 §3.4).
-- Includes p_category itself when it is in a family; empty when it is in none. Never hard-coded.
create function public.category_family_mates(p_category public.issue_category, p_families jsonb)
returns public.issue_category[]
language plpgsql
immutable
security definer
set search_path = public, extensions
as $$
begin
  if jsonb_typeof(p_families) is distinct from 'array' then
    raise exception 'p_config must contain compatible_families' using errcode = '22023';
  end if;
  return array(
    select distinct c::public.issue_category
    from jsonb_array_elements(p_families) f
    cross join lateral jsonb_array_elements_text(f) c
    where jsonb_typeof(f) = 'array' and f ? p_category::text
  );
end;
$$;

revoke all on function public.category_family_mates(public.issue_category, jsonb) from public, anon, authenticated;
grant execute on function public.category_family_mates(public.issue_category, jsonb) to service_role;

-- duplicate_candidates — GET /api/duplicate-candidates (02 §3.2–3.5). Read only; a jsonb array.
-- p_config = DUPLICATE_CONFIG (src/config/civic.ts): radius_m_by_category, window_days,
-- candidate_statuses, compatible_families, max_candidates — no number lives here.
-- Eligible: status in candidate_statuses; created within window_days; within the radius of the NEW
-- report's category (p_category) of the pinned point; category = p_category (match EXACT) or in one
-- compatible family with it (match FAMILY).
-- Order: EXACT before FAMILY, distance asc, newest first, id; at most max_candidates.
-- Element: {id, category, status, distance_m (1 decimal), report_count, primary_report_id (earliest
-- report), created_at, match, lat, lng}. No reporter ids, no paths, no score (06 rule 30).
-- ST_DWithin on geography against a constant point → issues_geom_gix.
create function public.duplicate_candidates(
  p_lat double precision,
  p_lng double precision,
  p_category public.issue_category,
  p_config jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_radius      double precision;
  v_window_days numeric := (p_config ->> 'window_days')::numeric;
  v_max         integer := (p_config ->> 'max_candidates')::integer;
  v_statuses    public.issue_status[];
  v_family      public.issue_category[];
  v_point       geography;
  v_result      jsonb;
begin
  if p_category is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'category required';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'invalid location';
  end if;

  v_radius := (p_config -> 'radius_m_by_category' ->> p_category::text)::double precision;
  if v_radius is null or v_window_days is null or v_max is null
     or jsonb_typeof(p_config -> 'candidate_statuses') is distinct from 'array' then
    raise exception 'p_config must contain radius_m_by_category (for %), window_days, candidate_statuses, compatible_families and max_candidates', p_category
      using errcode = '22023';
  end if;

  v_statuses := array(select s::public.issue_status from jsonb_array_elements_text(p_config -> 'candidate_statuses') s);
  v_family   := public.category_family_mates(p_category, p_config -> 'compatible_families');
  v_point    := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  select coalesce(jsonb_agg(c.item order by c.match_rank, c.distance, c.created_at desc, c.id), '[]'::jsonb)
  into v_result
  from (
    select
      i.id,
      i.created_at,
      d.distance,
      case when i.category = p_category then 0 else 1 end as match_rank,
      jsonb_build_object(
        'id', i.id,
        'category', i.category,
        'status', i.status,
        'distance_m', round(d.distance::numeric, 1),
        'report_count', (select count(*)::integer from public.reports r where r.issue_id = i.id),
        'primary_report_id', (select r.id from public.reports r where r.issue_id = i.id
                              order by r.created_at, r.id limit 1),
        'created_at', i.created_at,
        'match', case when i.category = p_category then 'EXACT' else 'FAMILY' end,
        'lat', st_y(i.geom::geometry),
        'lng', st_x(i.geom::geometry)
      ) as item
    from public.issues i
    cross join lateral (select st_distance(i.geom, v_point) as distance) d
    where i.status = any (v_statuses)
      and i.created_at >= now() - v_window_days * interval '1 day'
      and (i.category = p_category or i.category = any (v_family))
      and st_dwithin(i.geom, v_point, v_radius)
    order by match_rank, d.distance, i.created_at desc, i.id
    limit v_max
  ) c;

  return v_result;
end;
$$;

revoke all on function public.duplicate_candidates(double precision, double precision, public.issue_category, jsonb) from public, anon, authenticated;
grant execute on function public.duplicate_candidates(double precision, double precision, public.issue_category, jsonb) to service_role;

-- add_supporting_report — POST /api/issues/:id/support (02 §3.6, §9). "This is the same issue":
-- a new report row on an existing issue + SUPPORT_ADDED (actor = reporter, metadata {"report_id"}).
-- p_config = RATE_LIMIT_CONFIG + compatible_families (DUPLICATE_CONFIG). Checks, in order:
--   check_report_input (as create_report)
--   issue exists                    else PT404 NOT_FOUND 'issue not found'
--   a MERGED issue is followed to its merged_into_issue_id (no chains exist); that id is returned
--   target open                     else PT409 CONFLICT 'issue is closed'
--   p_category = issue category or in one compatible family
--                                   else PT400 VALIDATION_FAILED 'category does not match this issue'
--   check_report_rate_limit         PT429 RATE_LIMITED
-- The report keeps the citizen's own category, severity and pinned point. The issue's status,
-- priority, severity and geom never change; only updated_at is bumped. Does not trigger City
-- Pulse (02 §6.8). Returns {issue_id, report_id}.
create function public.add_supporting_report(
  p_actor_id uuid,
  p_ip_hash text,
  p_issue_id uuid,
  p_category public.issue_category,
  p_citizen_severity public.level,
  p_description text,
  p_image_path text,
  p_lat double precision,
  p_lng double precision,
  p_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_description text;
  v_issue_id    uuid;
  v_issue       public.issues%rowtype;
  v_hops        integer := 0;
  v_family      public.issue_category[];
  v_report_id   uuid;
begin
  v_description := public.check_report_input(p_actor_id, p_category, p_description, p_image_path, p_lat, p_lng);

  -- Read the requested issue without locking it, then lock only the issue the report goes to.
  -- A merge that commits while we wait for that lock leaves it MERGED: follow it again.
  select coalesce(i.merged_into_issue_id, i.id) into v_issue_id from public.issues i where i.id = p_issue_id;
  if v_issue_id is null then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', detail = 'issue not found';
  end if;
  loop
    select * into strict v_issue from public.issues where id = v_issue_id for update;
    exit when v_issue.status <> 'MERGED' or v_hops >= 3;
    v_issue_id := v_issue.merged_into_issue_id;
    v_hops := v_hops + 1;
  end loop;

  if v_issue.status not in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS') then
    raise exception using errcode = 'PT409', message = 'CONFLICT', detail = 'issue is closed';
  end if;
  v_family := public.category_family_mates(p_category, p_config -> 'compatible_families');
  if p_category <> v_issue.category and not (v_issue.category = any (v_family)) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'category does not match this issue';
  end if;

  perform public.check_report_rate_limit(p_actor_id, p_ip_hash, p_config);

  insert into public.reports (issue_id, reporter_user_id, reporter_ip_hash, category, citizen_severity,
                              description, image_path, geom)
  values (v_issue.id, p_actor_id, p_ip_hash, p_category, p_citizen_severity,
          v_description, p_image_path, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
  returning id into v_report_id;

  -- issues_touch_updated_at sets updated_at = now().
  update public.issues set updated_at = now() where id = v_issue.id;

  insert into public.issue_events (issue_id, actor_user_id, event_type, from_status, to_status, metadata)
  values (v_issue.id, p_actor_id, 'SUPPORT_ADDED', null, null, jsonb_build_object('report_id', v_report_id));

  return jsonb_build_object('issue_id', v_issue.id, 'report_id', v_report_id);
end;
$$;

revoke all on function public.add_supporting_report(uuid, text, uuid, public.issue_category, public.level, text, text, double precision, double precision, jsonb) from public, anon, authenticated;
grant execute on function public.add_supporting_report(uuid, text, uuid, public.issue_category, public.level, text, text, double precision, double precision, jsonb) to service_role;

-- merge_issue — POST /api/issues/:id/merge (02 §3.7, §4). Source → MERGED into target, in one
-- transaction. Checks, in order:
--   is_authority(p_actor_id)          else PT403 FORBIDDEN 'authority only'
--   source <> target                  else PT400 VALIDATION_FAILED 'cannot merge an issue into itself'
--   both exist (locked FOR UPDATE in id order, so concurrent merges cannot deadlock)
--                                     else PT404 NOT_FOUND 'source issue not found' / 'target issue not found'
--   source → MERGED allowed by status_transition_rules()  else PT409 INVALID_TRANSITION
--   target open                       else PT409 CONFLICT 'target issue is closed'
-- Then: move every source report to the target; repoint earlier merges (merged_into = source →
-- target) so no chains exist; source MERGED + merged_into_issue_id; MERGED_INTO on the source
-- (from/to status, note, metadata {target_issue_id, moved_report_ids}) and MERGED_FROM on the target
-- (note, metadata {source_issue_id, moved_report_ids}); target updated_at bumped. The target keeps
-- its own geom, category, severities, priority and department.
-- Returns {source_issue_id, target_issue_id, moved_report_ids} (ids oldest report first).
create function public.merge_issue(p_actor_id uuid, p_source_id uuid, p_target_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_note   text := nullif(regexp_replace(p_note, '^\s+|\s+$', '', 'g'), '');
  v_source public.issues%rowtype;
  v_target public.issues%rowtype;
  v_event  text;
  v_moved  jsonb;
begin
  if not public.is_authority(p_actor_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'authority only';
  end if;
  if p_source_id = p_target_id then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'cannot merge an issue into itself';
  end if;

  perform 1 from public.issues where id = least(p_source_id, p_target_id) for update;
  perform 1 from public.issues where id = greatest(p_source_id, p_target_id) for update;

  select * into v_source from public.issues where id = p_source_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', detail = 'source issue not found';
  end if;
  select * into v_target from public.issues where id = p_target_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', detail = 'target issue not found';
  end if;

  v_event := public.transition_event(v_source.status, 'MERGED');
  if v_target.status not in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS') then
    raise exception using errcode = 'PT409', message = 'CONFLICT', detail = 'target issue is closed';
  end if;

  -- 1. move every source report
  select coalesce(jsonb_agg(r.id order by r.created_at, r.id), '[]'::jsonb) into v_moved
  from public.reports r where r.issue_id = p_source_id;
  update public.reports set issue_id = p_target_id where issue_id = p_source_id;

  -- 2. repoint earlier merges into the source
  update public.issues set merged_into_issue_id = p_target_id where merged_into_issue_id = p_source_id;

  -- 3. source → MERGED; target updated_at bumped by issues_touch_updated_at
  update public.issues set status = 'MERGED', merged_into_issue_id = p_target_id where id = p_source_id;
  update public.issues set updated_at = now() where id = p_target_id;

  -- 4. both events
  insert into public.issue_events (issue_id, actor_user_id, event_type, from_status, to_status, note, metadata)
  values
    (p_source_id, p_actor_id, v_event, v_source.status, 'MERGED', v_note,
     jsonb_build_object('target_issue_id', p_target_id, 'moved_report_ids', v_moved)),
    (p_target_id, p_actor_id, 'MERGED_FROM', null, null, v_note,
     jsonb_build_object('source_issue_id', p_source_id, 'moved_report_ids', v_moved));

  return jsonb_build_object('source_issue_id', p_source_id, 'target_issue_id', p_target_id, 'moved_report_ids', v_moved);
end;
$$;

revoke all on function public.merge_issue(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.merge_issue(uuid, uuid, uuid, text) to service_role;

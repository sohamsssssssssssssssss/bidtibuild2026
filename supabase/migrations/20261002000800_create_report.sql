-- CivicPulse AI — Phase 1: create_report (02 §4, §7.3, §9, §10.2; 04 §3).
--
-- Error convention (04 §3, all phases): functions raise
--   raise exception using errcode = 'PT<http>', message = '<ERROR_CODES key>', detail = '<reason>';
-- PostgREST turns SQLSTATE PTxyz into HTTP xyz and supabase-js surfaces
-- { code: 'PTxyz', message: '<ERROR_CODES key>', details: '<reason>' }; the route maps it.

-- check_report_rate_limit — 02 §9, shared by create_report and (Phase 3) add_supporting_report.
-- Counts `reports` rows in the rolling window. The numbers come from p_config
-- (RATE_LIMIT_CONFIG in src/config/civic.ts), never from this file. A null p_ip_hash skips the
-- per-IP limit. Raises PT429 RATE_LIMITED (detail 'per-user limit' / 'per-IP limit').
-- `ponytail:` count and insert are not serialised (02 §9).
create function public.check_report_rate_limit(p_actor_id uuid, p_ip_hash text, p_config jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_window_hours numeric  := (p_config ->> 'window_hours')::numeric;
  v_max_user     integer  := (p_config ->> 'max_reports_per_user')::integer;
  v_max_ip       integer  := (p_config ->> 'max_reports_per_ip_hash')::integer;
  v_since        timestamptz;
begin
  if v_window_hours is null or v_max_user is null or v_max_ip is null then
    raise exception 'p_config must contain window_hours, max_reports_per_user and max_reports_per_ip_hash'
      using errcode = '22023';
  end if;

  v_since := now() - v_window_hours * interval '1 hour';

  if (select count(*) from public.reports r
      where r.reporter_user_id = p_actor_id and r.created_at > v_since) >= v_max_user then
    raise exception using errcode = 'PT429', message = 'RATE_LIMITED', detail = 'per-user limit';
  end if;

  if p_ip_hash is not null and (select count(*) from public.reports r
      where r.reporter_ip_hash = p_ip_hash and r.created_at > v_since) >= v_max_ip then
    raise exception using errcode = 'PT429', message = 'RATE_LIMITED', detail = 'per-IP limit';
  end if;
end;
$$;

revoke all on function public.check_report_rate_limit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.check_report_rate_limit(uuid, text, jsonb) to service_role;

-- create_report — POST /api/reports. New issue (REPORTED) + its first report + a CREATED event,
-- in one transaction. Returns {"issue_id": ..., "report_id": ...}.
-- Defence in depth (02 §10.2): the route already checked the image-path prefix; re-check it and
-- that the object exists in the report-photos bucket.
create function public.create_report(
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
  -- Trim all surrounding whitespace (like Zod's .trim()), not only spaces.
  v_description text := regexp_replace(p_description, '^\s+|\s+$', '', 'g');
  v_geom        geography;
  v_issue_id    uuid;
  v_report_id   uuid;
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

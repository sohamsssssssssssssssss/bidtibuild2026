-- CivicPulse AI — Phase 0: public read functions (02 §7.4, §10.3, §12; 04 §3).
-- Called by the API routes with the service role. They return storage *paths*; the route turns
-- them into public URLs. They never return reporter_user_id, reporter_ip_hash or actor ids
-- (06 rule 22), and every image path of a REJECTED issue is null (02 §10.3).
-- Output keys match src/contracts (issues.ts, reports.ts) with `image_path` in place of `image_url`.

-- map_issues — GET /api/issues markers inside a WGS84 bbox (02 §12).
-- REJECTED and MERGED are never returned (contract MAP_STATUSES); a null array means no filter.
-- The bbox is a plain lng/lat rectangle (what the map shows), checked exactly in planar
-- coordinates. `geom && <padded geography envelope>` is only an index pre-filter: a geography
-- envelope has great-circle edges, so it is padded to stay a superset of the rectangle. Boxes
-- spanning 90°+ cannot be represented that way and skip the pre-filter (zoomed-out views only).
create function public.map_issues(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_categories public.issue_category[] default null,
  p_statuses public.issue_status[] default null
)
returns table (
  id uuid,
  category public.issue_category,
  status public.issue_status,
  lat double precision,
  lng double precision,
  final_priority public.level,
  report_count integer,
  created_at timestamptz,
  is_seed boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_env geometry := st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326);
  v_pad double precision := 0.1 * greatest(p_max_lng - p_min_lng, p_max_lat - p_min_lat) + 0.001;
  v_prefilter geography;
begin
  if p_max_lng - p_min_lng < 90 and p_max_lat - p_min_lat < 90 then
    v_prefilter := st_makeenvelope(
      greatest(p_min_lng - v_pad, -180), greatest(p_min_lat - v_pad, -90),
      least(p_max_lng + v_pad, 180),     least(p_max_lat + v_pad, 90), 4326)::geography;
  end if;

  return query
  select i.id, i.category, i.status,
         st_y(i.geom::geometry), st_x(i.geom::geometry),
         i.final_priority,
         (select count(*)::integer from public.reports r where r.issue_id = i.id),
         i.created_at, i.is_seed
  from public.issues i
  where i.status not in ('REJECTED', 'MERGED')
    and (v_prefilter is null or i.geom && v_prefilter)
    and st_intersects(i.geom::geometry, v_env)
    and (p_categories is null or i.category = any (p_categories))
    and (p_statuses is null or i.status = any (p_statuses))
  order by i.created_at desc, i.id;
end;
$$;

revoke all on function public.map_issues(double precision, double precision, double precision, double precision, public.issue_category[], public.issue_status[]) from public, anon, authenticated;
grant execute on function public.map_issues(double precision, double precision, double precision, double precision, public.issue_category[], public.issue_status[]) to service_role;

-- issue_detail — GET /api/issues/:id. One jsonb object, or null when the issue does not exist or
-- the viewer may not see it. Mirrors the issues RLS policy (04 §4): a REJECTED issue is visible
-- only to an authority or to a viewer with a report on it. MERGED issues are returned with
-- merged_into_issue_id set (their reports now live on the target, so `photos` is empty).
-- Timeline actor ids become SYSTEM (null actor) / AUTHORITY (is_authority) / CITIZEN.
create function public.issue_detail(p_issue_id uuid, p_viewer_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_issue public.issues%rowtype;
  v_hide_images boolean;
begin
  select * into v_issue from public.issues where id = p_issue_id;
  if not found then
    return null;
  end if;

  v_hide_images := v_issue.status = 'REJECTED';
  if v_hide_images and not (
    p_viewer_id is not null and (
      public.is_authority(p_viewer_id)
      or exists (select 1 from public.reports r where r.issue_id = p_issue_id and r.reporter_user_id = p_viewer_id)
    )
  ) then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_issue.id,
    'category', v_issue.category,
    'status', v_issue.status,
    'citizen_severity', v_issue.citizen_severity,
    'authority_severity', v_issue.authority_severity,
    'final_priority', v_issue.final_priority,
    'lat', st_y(v_issue.geom::geometry),
    'lng', st_x(v_issue.geom::geometry),
    'department', (
      select jsonb_build_object('id', d.id, 'name', d.name)
      from public.departments d where d.id = v_issue.assigned_department_id
    ),
    'assigned_at', v_issue.assigned_at,
    'sla_due_at', v_issue.sla_due_at,
    'created_at', v_issue.created_at,
    'updated_at', v_issue.updated_at,
    'resolved_at', v_issue.resolved_at,
    'merged_into_issue_id', v_issue.merged_into_issue_id,
    'is_seed', v_issue.is_seed,
    'report_count', (select count(*)::integer from public.reports r where r.issue_id = p_issue_id),
    -- Primary (earliest) report first, then oldest → newest.
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'image_path', case when v_hide_images then null else r.image_path end,
               'description', r.description,
               'category', r.category,
               'citizen_severity', r.citizen_severity,
               'created_at', r.created_at)
             order by r.created_at, r.id)
      from public.reports r where r.issue_id = p_issue_id
    ), '[]'::jsonb),
    -- Oldest first. No actor id, no metadata (metadata can hold report ids).
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id,
               'event_type', e.event_type,
               'from_status', e.from_status,
               'to_status', e.to_status,
               'note', e.note,
               'actor', case
                          when e.actor_user_id is null then 'SYSTEM'
                          when public.is_authority(e.actor_user_id) then 'AUTHORITY'
                          else 'CITIZEN'
                        end,
               'created_at', e.created_at)
             order by e.created_at, e.id)
      from public.issue_events e where e.issue_id = p_issue_id
    ), '[]'::jsonb),
    -- Oldest first. No uploaded_by.
    'resolution_evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', re.id,
               'image_path', case when v_hide_images then null else re.image_path end,
               'note', re.note,
               'created_at', re.created_at)
             order by re.created_at, re.id)
      from public.resolution_evidence re where re.issue_id = p_issue_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.issue_detail(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_detail(uuid, uuid) to service_role;

-- my_reports — GET /api/my-reports. A jsonb array of the user's reports, newest first, each with
-- its CURRENT issue. Merges move report rows to the target (02 §3.7), so joining on
-- reports.issue_id follows them. Image paths are null when the issue is REJECTED.
create function public.my_reports(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'category', r.category,
           'citizen_severity', r.citizen_severity,
           'description', r.description,
           'image_path', case when i.status = 'REJECTED' then null else r.image_path end,
           'lat', st_y(r.geom::geometry),
           'lng', st_x(r.geom::geometry),
           'created_at', r.created_at,
           'issue', jsonb_build_object(
             'id', i.id,
             'status', i.status,
             'category', i.category,
             'final_priority', i.final_priority,
             'report_count', (select count(*)::integer from public.reports r2 where r2.issue_id = i.id),
             'updated_at', i.updated_at,
             'resolved_at', i.resolved_at,
             'latest_resolution_evidence', (
               select jsonb_build_object(
                        'id', re.id,
                        'image_path', case when i.status = 'REJECTED' then null else re.image_path end,
                        'note', re.note,
                        'created_at', re.created_at)
               from public.resolution_evidence re
               where re.issue_id = i.id
               order by re.created_at desc, re.id desc
               limit 1
             )
           ))
         order by r.created_at desc, r.id desc), '[]'::jsonb)
  from public.reports r
  join public.issues i on i.id = r.issue_id
  where p_user_id is not null and r.reporter_user_id = p_user_id;
$$;

revoke all on function public.my_reports(uuid) from public, anon, authenticated;
grant execute on function public.my_reports(uuid) to service_role;

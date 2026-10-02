-- CivicPulse AI — photos are served by the app, never by public Storage URLs (02 §10.2–10.3, §13).
--
-- Object paths are `{uid}/{uuid}.jpg` (required by the insert policies), so a Storage URL would
-- expose the uploader's uid (06 rule 22, 02 §7.4). Instead:
--   * both buckets become private (no public read);
--   * the read functions return photo *references* (`has_photo` on each report / evidence row,
--     keyed by that row's id) instead of storage paths;
--   * GET /api/photos/:kind/:id resolves the object with `photo_object` (service role) and streams
--     it back, applying the same visibility rule as issue_detail / the issues RLS policy (04 §4).

-- Storage ------------------------------------------------------------------------------------------

update storage.buckets set public = false where id in ('report-photos', 'resolution-photos');

drop policy if exists "civicpulse photos: public read" on storage.objects;

-- Uploaders may read back their own folder only (an upload that reads its row back, a client-side
-- preview). A plain upload (upsert: false) needs only the INSERT policies; there is still no
-- UPDATE/DELETE policy, so upsert and remove stay impossible (02 §10.3: kept for audit).
create policy "report-photos: read own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "resolution-photos: read own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'resolution-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- photo_object ---------------------------------------------------------------------------------------
-- GET /api/photos/:kind/:id. `report` → the report's photo in report-photos; `evidence` → the
-- resolution_evidence photo in resolution-photos. Returns {bucket, path, public} or null (unknown
-- kind or id, or not visible to the viewer). A photo of a REJECTED issue is returned only to an
-- authority or to a viewer with a report on that issue (same rule as issue_detail). `public` is
-- false exactly then: the route must not let shared caches keep such a viewer-specific response.
create function public.photo_object(p_kind text, p_id uuid, p_viewer_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bucket text;
  v_path text;
  v_issue_id uuid;
  v_status public.issue_status;
begin
  if p_kind = 'report' then
    select 'report-photos', r.image_path, r.issue_id into v_bucket, v_path, v_issue_id
    from public.reports r where r.id = p_id;
  elsif p_kind = 'evidence' then
    select 'resolution-photos', re.image_path, re.issue_id into v_bucket, v_path, v_issue_id
    from public.resolution_evidence re where re.id = p_id;
  else
    return null;
  end if;

  if v_path is null then
    return null;
  end if;

  select i.status into v_status from public.issues i where i.id = v_issue_id;

  if v_status = 'REJECTED' and not (
    p_viewer_id is not null and (
      public.is_authority(p_viewer_id)
      or exists (select 1 from public.reports r where r.issue_id = v_issue_id and r.reporter_user_id = p_viewer_id)
    )
  ) then
    return null;
  end if;

  return jsonb_build_object('bucket', v_bucket, 'path', v_path, 'public', v_status <> 'REJECTED');
end;
$$;

revoke all on function public.photo_object(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.photo_object(text, uuid, uuid) to service_role;

-- issue_detail -----------------------------------------------------------------------------------------
-- Same as 20261002000700 except photos: each report / evidence row carries `has_photo` instead of
-- `image_path`; the route turns it into `/api/photos/{report|evidence}/{id}`. A REJECTED issue is
-- returned only to an authority or a viewer with a report on it, and photo_object serves its
-- photos to exactly those viewers, so every returned row has `has_photo = true` (previously the
-- paths were nulled for everyone, including the authority).
create or replace function public.issue_detail(p_issue_id uuid, p_viewer_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_issue public.issues%rowtype;
begin
  select * into v_issue from public.issues where id = p_issue_id;
  if not found then
    return null;
  end if;

  if v_issue.status = 'REJECTED' and not (
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
    -- Primary (earliest) report first, then oldest → newest. Photo: /api/photos/report/<id>.
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'has_photo', true,
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
    -- Oldest first. No uploaded_by. Photo: /api/photos/evidence/<id>.
    'resolution_evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', re.id,
               'has_photo', true,
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

-- my_reports -------------------------------------------------------------------------------------------
-- Same as 20261002000700 except photos: `has_photo` instead of `image_path`. The caller has a
-- report on every issue listed here, so photo_object serves all these photos to them, REJECTED
-- issues included (the reporter's own photo and the issue's evidence) — `has_photo` is always true.
create or replace function public.my_reports(p_user_id uuid)
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
           'has_photo', true,
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
                        'has_photo', true,
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

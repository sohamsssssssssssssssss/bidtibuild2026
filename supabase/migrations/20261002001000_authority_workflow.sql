-- CivicPulse AI — Phase 2: authority workflow (02 §4, §5.1, §5.4, §7.3, §8; 04 §3).
--
-- Error convention (04 §3): raise exception using errcode = 'PT<http>', message = '<ERROR_CODES key>',
-- detail = '<reason>'. Every write function checks, in this order:
--   1. is_authority(p_actor_id)                       else PT403 FORBIDDEN
--   2. the issue row, locked FOR UPDATE                else PT404 NOT_FOUND
--   3. input / state                                   PT400 VALIDATION_FAILED, PT409 INVALID_TRANSITION / CONFLICT
-- and writes the change plus its issue_events row(s) in the caller's transaction.
-- issues.updated_at is bumped by the issues_touch_updated_at trigger.

-- status_transition_rules — the ONE SQL copy of 02 §4, one row per (from_status, to_status).
-- The creation row (— → REPORTED, CREATED) has no from_status and is left out. Stretch (reopen)
-- rows are flagged stretch = true and are not enforced by the write functions until reopen ships.
-- MERGED rows are enforced by merge_issue (Phase 3). scripts/db-test/check-transitions.ts asserts
-- this table equals STATUS_TRANSITIONS in src/config/civic.ts (02 §15). Change both together.
create function public.status_transition_rules()
returns table (from_status public.issue_status, to_status public.issue_status, event_type text, stretch boolean)
language sql
immutable
security definer
set search_path = public, extensions
as $$
  select r.from_status::public.issue_status, r.to_status::public.issue_status, r.event_type, r.stretch
  from (values
    ('REPORTED',    'ASSIGNED',    'ASSIGNED',       false),
    ('ASSIGNED',    'ASSIGNED',    'REASSIGNED',     false),  -- a *different* department
    ('IN_PROGRESS', 'ASSIGNED',    'REASSIGNED',     false),  -- a *different* department
    ('ASSIGNED',    'IN_PROGRESS', 'STATUS_CHANGED', false),
    ('IN_PROGRESS', 'RESOLVED',    'RESOLVED',       false),  -- evidence row in the same transaction
    ('REPORTED',    'REJECTED',    'REJECTED',       false),  -- reason required
    ('ASSIGNED',    'REJECTED',    'REJECTED',       false),  -- reason required
    ('REPORTED',    'MERGED',      'MERGED_INTO',    false),  -- 02 §3.7
    ('ASSIGNED',    'MERGED',      'MERGED_INTO',    false),
    ('IN_PROGRESS', 'MERGED',      'MERGED_INTO',    false),
    -- Stretch (reopen)
    ('RESOLVED',    'REOPENED',    'REOPENED',       true),   -- reason required
    ('REOPENED',    'ASSIGNED',    'ASSIGNED',       true),
    ('REOPENED',    'IN_PROGRESS', 'STATUS_CHANGED', true),
    ('REOPENED',    'REJECTED',    'REJECTED',       true),
    ('REOPENED',    'MERGED',      'MERGED_INTO',    true)
  ) as r (from_status, to_status, event_type, stretch);
$$;

revoke all on function public.status_transition_rules() from public, anon, authenticated;
grant execute on function public.status_transition_rules() to service_role;

-- transition_event — the event_type of the enabled (non-stretch) rule from → to, or
-- PT409 INVALID_TRANSITION (detail 'REPORTED -> IN_PROGRESS not allowed').
-- Every write function derives its event from here; none repeats the transition table.
create function public.transition_event(p_from public.issue_status, p_to public.issue_status)
returns text
language plpgsql
immutable
security definer
set search_path = public, extensions
as $$
declare
  v_event text;
begin
  select r.event_type into v_event
  from public.status_transition_rules() r
  where r.from_status = p_from and r.to_status = p_to and not r.stretch;

  if v_event is null then
    raise exception using errcode = 'PT409', message = 'INVALID_TRANSITION',
      detail = format('%s -> %s not allowed', p_from, p_to);
  end if;
  return v_event;
end;
$$;

revoke all on function public.transition_event(public.issue_status, public.issue_status) from public, anon, authenticated;
grant execute on function public.transition_event(public.issue_status, public.issue_status) to service_role;

-- set_priority — PATCH /api/issues/:id/priority (02 §5.1, §5.4). Sets final_priority and/or
-- authority_severity (null = leave as is; at least one required). An event is written only for a
-- value that actually changes (PRIORITY_SET / SEVERITY_CONFIRMED, metadata {"from", "to"}), so a
-- repeated call is a no-op. Only on open issues (REPORTED, ASSIGNED, IN_PROGRESS).
-- Returns {issue_id, status, updated_at, final_priority, authority_severity}.
create function public.set_priority(
  p_actor_id uuid,
  p_issue_id uuid,
  p_final_priority public.level,
  p_authority_severity public.level
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_issue   public.issues%rowtype;
  v_changed boolean := false;
begin
  if not public.is_authority(p_actor_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'authority only';
  end if;

  select * into v_issue from public.issues where id = p_issue_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', detail = 'issue not found';
  end if;

  if p_final_priority is null and p_authority_severity is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED',
      detail = 'final_priority or authority_severity required';
  end if;
  if v_issue.status not in ('REPORTED', 'ASSIGNED', 'IN_PROGRESS') then
    raise exception using errcode = 'PT409', message = 'CONFLICT', detail = 'issue is closed';
  end if;

  if p_final_priority is not null and p_final_priority is distinct from v_issue.final_priority then
    insert into public.issue_events (issue_id, actor_user_id, event_type, metadata)
    values (p_issue_id, p_actor_id, 'PRIORITY_SET',
            jsonb_build_object('from', v_issue.final_priority, 'to', p_final_priority));
    v_issue.final_priority := p_final_priority;
    v_changed := true;
  end if;

  if p_authority_severity is not null and p_authority_severity is distinct from v_issue.authority_severity then
    insert into public.issue_events (issue_id, actor_user_id, event_type, metadata)
    values (p_issue_id, p_actor_id, 'SEVERITY_CONFIRMED',
            jsonb_build_object('from', v_issue.authority_severity, 'to', p_authority_severity));
    v_issue.authority_severity := p_authority_severity;
    v_changed := true;
  end if;

  if v_changed then
    update public.issues
    set final_priority = v_issue.final_priority, authority_severity = v_issue.authority_severity
    where id = p_issue_id
    returning * into v_issue;
  end if;

  return jsonb_build_object(
    'issue_id', v_issue.id,
    'status', v_issue.status,
    'updated_at', v_issue.updated_at,
    'final_priority', v_issue.final_priority,
    'authority_severity', v_issue.authority_severity
  );
end;
$$;

revoke all on function public.set_priority(uuid, uuid, public.level, public.level) from public, anon, authenticated;
grant execute on function public.set_priority(uuid, uuid, public.level, public.level) to service_role;

-- assign_issue — POST /api/issues/:id/assign (02 §4, §8). REPORTED → ASSIGNED (event ASSIGNED);
-- ASSIGNED / IN_PROGRESS → ASSIGNED with a different department (event REASSIGNED). The event
-- comes from status_transition_rules(). The department must exist and be active.
-- Sets assigned_at = now() and sla_due_at = assigned_at + departments.sla_hours.
-- Returns {issue_id, status, updated_at, event_type, department: {id, name}, assigned_at, sla_due_at}.
create function public.assign_issue(p_actor_id uuid, p_issue_id uuid, p_department_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_issue public.issues%rowtype;
  v_dept  public.departments%rowtype;
  v_from  public.issue_status;
  v_prev  uuid;
  v_event text;
begin
  if not public.is_authority(p_actor_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'authority only';
  end if;

  select * into v_issue from public.issues where id = p_issue_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', detail = 'issue not found';
  end if;

  select * into v_dept from public.departments where id = p_department_id;
  if not found or not v_dept.active then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'department not found or inactive';
  end if;

  v_from  := v_issue.status;
  v_prev  := v_issue.assigned_department_id;
  v_event := public.transition_event(v_from, 'ASSIGNED');

  if v_event = 'REASSIGNED' and v_prev = p_department_id then
    raise exception using errcode = 'PT409', message = 'CONFLICT', detail = 'already assigned to this department';
  end if;

  update public.issues
  set status = 'ASSIGNED',
      assigned_department_id = p_department_id,
      assigned_at = now(),
      sla_due_at = now() + v_dept.sla_hours * interval '1 hour'
  where id = p_issue_id
  returning * into v_issue;

  insert into public.issue_events (issue_id, actor_user_id, event_type, from_status, to_status, metadata)
  values (p_issue_id, p_actor_id, v_event, v_from, 'ASSIGNED',
          jsonb_build_object('department_id', p_department_id, 'previous_department_id', v_prev));

  return jsonb_build_object(
    'issue_id', v_issue.id,
    'status', v_issue.status,
    'updated_at', v_issue.updated_at,
    'event_type', v_event,
    'department', jsonb_build_object('id', v_dept.id, 'name', v_dept.name),
    'assigned_at', v_issue.assigned_at,
    'sla_due_at', v_issue.sla_due_at
  );
end;
$$;

revoke all on function public.assign_issue(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_issue(uuid, uuid, uuid) to service_role;

-- transition_issue — PATCH /api/issues/:id/status (02 §4). Handles the status-only transitions:
-- → IN_PROGRESS (event STATUS_CHANGED) and → REJECTED (event REJECTED; trimmed note required).
-- Whether the move is allowed from the current status comes from status_transition_rules().
-- Other targets belong to other functions (assign_issue, resolve_issue, merge_issue) or to the
-- reopen stretch, and raise PT409 INVALID_TRANSITION. The note is stored trimmed (blank → null).
-- Returns {issue_id, status, updated_at, from_status}.
create function public.transition_issue(
  p_actor_id uuid,
  p_issue_id uuid,
  p_to_status public.issue_status,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_note  text := nullif(regexp_replace(p_note, '^\s+|\s+$', '', 'g'), '');
  v_issue public.issues%rowtype;
  v_from  public.issue_status;
  v_event text;
begin
  if not public.is_authority(p_actor_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'authority only';
  end if;

  select * into v_issue from public.issues where id = p_issue_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', detail = 'issue not found';
  end if;
  v_from := v_issue.status;

  if p_to_status is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'to_status required';
  end if;
  if p_to_status not in ('IN_PROGRESS', 'REJECTED') then
    raise exception using errcode = 'PT409', message = 'INVALID_TRANSITION',
      detail = format('%s -> %s not allowed here: %s', v_from, p_to_status, case p_to_status
        when 'ASSIGNED' then 'use assign_issue'
        when 'RESOLVED' then 'use resolve_issue'
        when 'MERGED'   then 'use merge_issue'
        when 'REOPENED' then 'reopen is a stretch feature and not enabled'
        else 'not a target status'
      end);
  end if;
  if p_to_status = 'REJECTED' and v_note is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'a reason is required to reject';
  end if;

  v_event := public.transition_event(v_from, p_to_status);

  update public.issues set status = p_to_status where id = p_issue_id
  returning * into v_issue;

  insert into public.issue_events (issue_id, actor_user_id, event_type, from_status, to_status, note)
  values (p_issue_id, p_actor_id, v_event, v_from, p_to_status, v_note);

  return jsonb_build_object(
    'issue_id', v_issue.id,
    'status', v_issue.status,
    'updated_at', v_issue.updated_at,
    'from_status', v_from
  );
end;
$$;

revoke all on function public.transition_issue(uuid, uuid, public.issue_status, text) from public, anon, authenticated;
grant execute on function public.transition_issue(uuid, uuid, public.issue_status, text) to service_role;

-- resolve_issue — POST /api/issues/:id/resolution (02 §4, §10.2; 06 rule 20). IN_PROGRESS → RESOLVED
-- with a resolution_evidence row in the same transaction. Defence in depth: the route already
-- checked the path prefix; re-check it and that the object exists in the resolution-photos bucket.
-- Event RESOLVED carries the note and metadata {"evidence_id"}.
-- Returns {issue_id, status, updated_at, resolved_at, evidence: {id, note, created_at}} — no image
-- path; the route adds the photo URL.
create function public.resolve_issue(p_actor_id uuid, p_issue_id uuid, p_image_path text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_note     text := nullif(regexp_replace(p_note, '^\s+|\s+$', '', 'g'), '');
  v_issue    public.issues%rowtype;
  v_evidence public.resolution_evidence%rowtype;
  v_from     public.issue_status;
  v_event    text;
begin
  if not public.is_authority(p_actor_id) then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'authority only';
  end if;

  select * into v_issue from public.issues where id = p_issue_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND', detail = 'issue not found';
  end if;
  v_from := v_issue.status;

  v_event := public.transition_event(v_from, 'RESOLVED');

  if p_image_path is null or p_image_path = '' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'image_path required';
  end if;
  if not starts_with(p_image_path, p_actor_id::text || '/') then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN', detail = 'image_path is not in the caller''s folder';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'resolution-photos' and o.name = p_image_path
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_FAILED', detail = 'photo not found in storage';
  end if;

  insert into public.resolution_evidence (issue_id, uploaded_by, image_path, note)
  values (p_issue_id, p_actor_id, p_image_path, v_note)
  returning * into v_evidence;

  update public.issues set status = 'RESOLVED', resolved_at = now() where id = p_issue_id
  returning * into v_issue;

  insert into public.issue_events (issue_id, actor_user_id, event_type, from_status, to_status, note, metadata)
  values (p_issue_id, p_actor_id, v_event, v_from, 'RESOLVED', v_note,
          jsonb_build_object('evidence_id', v_evidence.id));

  return jsonb_build_object(
    'issue_id', v_issue.id,
    'status', v_issue.status,
    'updated_at', v_issue.updated_at,
    'resolved_at', v_issue.resolved_at,
    'evidence', jsonb_build_object('id', v_evidence.id, 'note', v_evidence.note, 'created_at', v_evidence.created_at)
  );
end;
$$;

revoke all on function public.resolve_issue(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_issue(uuid, uuid, text, text) to service_role;

-- authority_queue — GET /api/authority/queue. Read only; a jsonb array, one element per issue whose
-- status is in p_filters.statuses (default p_config.queue_statuses = the open statuses).
-- p_config is PRIORITY_CONFIG (src/config/civic.ts); v1 reads only queue_statuses and
-- default_severity. p_filters: {statuses: text[]|null, categories: text[]|null,
-- department_id: uuid|null, unassigned_only: boolean}; null / missing = no filter.
-- Effective severity (02 §5.4): authority_severity → citizen_severity → default_severity, with
-- severity_source AUTHORITY | CITIZEN | DEFAULT.
-- Queue v1 (Phase 2): factors, score, label and recurrence_count are null, and the order is
-- final_priority CRITICAL → LOW, then unset, then oldest first. Phase 4 fills the factors and
-- sorts by score descending (02 §5.2). Never returns reporter ids — only counts.
create function public.authority_queue(p_config jsonb, p_filters jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_filters          jsonb := coalesce(p_filters, '{}'::jsonb);
  v_default_severity public.level := (p_config ->> 'default_severity')::public.level;
  v_statuses         public.issue_status[];
  v_categories       public.issue_category[];
  v_department_id    uuid := (v_filters ->> 'department_id')::uuid;
  v_unassigned_only  boolean := coalesce((v_filters ->> 'unassigned_only')::boolean, false);
  v_result           jsonb;
begin
  if v_default_severity is null or jsonb_typeof(p_config -> 'queue_statuses') is distinct from 'array' then
    raise exception 'p_config must contain queue_statuses and default_severity' using errcode = '22023';
  end if;

  v_statuses := array(
    select s::public.issue_status
    from jsonb_array_elements_text(case jsonb_typeof(v_filters -> 'statuses')
                                     when 'array' then v_filters -> 'statuses'
                                     else p_config -> 'queue_statuses' end) s);
  if jsonb_typeof(v_filters -> 'categories') = 'array' then
    v_categories := array(select c::public.issue_category from jsonb_array_elements_text(v_filters -> 'categories') c);
  end if;

  select coalesce(jsonb_agg(q.item order by q.priority_rank, q.created_at, q.id), '[]'::jsonb)
  into v_result
  from (
    select
      i.id,
      i.created_at,
      case i.final_priority when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'LOW' then 3 else 4 end
        as priority_rank,
      jsonb_build_object(
        'id', i.id,
        'category', i.category,
        'status', i.status,
        'final_priority', i.final_priority,
        'effective_severity', coalesce(i.authority_severity, i.citizen_severity, v_default_severity),
        'severity_source', case
                             when i.authority_severity is not null then 'AUTHORITY'
                             when i.citizen_severity is not null then 'CITIZEN'
                             else 'DEFAULT'
                           end,
        'factors', null,
        'score', null,
        'label', null,
        'distinct_reporter_count', rc.distinct_reporters,
        'recurrence_count', null,
        'report_count', rc.reports,
        'department', case when d.id is null then null else jsonb_build_object('id', d.id, 'name', d.name) end,
        'sla_due_at', i.sla_due_at,
        'created_at', i.created_at,
        'updated_at', i.updated_at,
        'is_seed', i.is_seed,
        'lat', st_y(i.geom::geometry),
        'lng', st_x(i.geom::geometry)
      ) as item
    from public.issues i
    left join public.departments d on d.id = i.assigned_department_id
    cross join lateral (
      select count(*)::integer as reports, count(distinct r.reporter_user_id)::integer as distinct_reporters
      from public.reports r where r.issue_id = i.id
    ) rc
    where i.status = any (v_statuses)
      and (v_categories is null or i.category = any (v_categories))
      and (v_department_id is null or i.assigned_department_id = v_department_id)
      and (not v_unassigned_only or i.assigned_department_id is null)
  ) q;

  return v_result;
end;
$$;

revoke all on function public.authority_queue(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.authority_queue(jsonb, jsonb) to service_role;

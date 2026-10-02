# CivicPulse AI — Database Schema
**Version:** 0.3
Numbers live in `02_TECHNICAL_SPEC.md`. The migrations in `supabase/migrations/` are the executable truth; this doc must match them.

PostGIS is installed in the `extensions` schema (Supabase convention), so geometry columns are typed `extensions.geography(...)` in the migrations.

## 1. Enums
- `issue_category` — values in `02` §3.1
- `issue_status` — `REPORTED`, `ASSIGNED`, `IN_PROGRESS`, `RESOLVED`, `REJECTED`, `MERGED`, `REOPENED` (`REOPENED` is used only once the reopen stretch ships)
- `level` — `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`; used for severity, final priority and hotspot severity
- `user_role` — `AUTHORITY`

## 2. Tables

### users — authority accounts
- `id uuid pk references auth.users(id) on delete cascade`
- `name text not null`
- `email text not null`
- `role user_role not null default 'AUTHORITY'`
- `created_at timestamptz not null default now()`

Citizens are anonymous auth users and have no row here in the MVP.

### departments
- `id uuid pk default gen_random_uuid()`
- `name text not null unique`
- `sla_hours integer not null` (seeded default in `02` §8)
- `default_categories issue_category[] not null default '{}'` — drives the assignment suggestion
- `active boolean not null default true`
- `created_at timestamptz not null default now()`

### issues — one physical problem
- `id uuid pk default gen_random_uuid()`
- `category issue_category not null`
- `status issue_status not null default 'REPORTED'`
- `citizen_severity level null` — copied from the first report
- `authority_severity level null`
- `final_priority level null`
- `geom geography(Point,4326) not null` — the first report's location
- `assigned_department_id uuid null references departments(id)`
- `assigned_at timestamptz null`
- `sla_due_at timestamptz null`
- `merged_into_issue_id uuid null references issues(id)`
- `is_seed boolean not null default false`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `resolved_at timestamptz null`

Trigger `issues_touch_updated_at` sets `updated_at = now()` on every UPDATE.

Checks:
- `(status = 'MERGED') = (merged_into_issue_id is not null)`
- `merged_into_issue_id <> id`
- `status in ('ASSIGNED','IN_PROGRESS')` implies `assigned_department_id is not null`
- `status = 'RESOLVED'` implies `resolved_at is not null`

There is no stored score, factor, support count or title (`02` §5.2).

### reports — one citizen submission
- `id uuid pk default gen_random_uuid()`
- `issue_id uuid not null references issues(id)`
- `reporter_user_id uuid not null` — `auth.uid()` of the submitting session. No FK, so seed rows can use fixed demo uuids.
- `reporter_ip_hash text null`
- `category issue_category not null` — as the citizen chose it; may differ within the compatible family
- `citizen_severity level null`
- `description text not null`
- `image_path text not null`
- `geom geography(Point,4326) not null`
- `created_at timestamptz not null default now()`

An issue's primary report is its earliest report.

### issue_events — append-only audit trail
- `id uuid pk default gen_random_uuid()`
- `issue_id uuid not null references issues(id)`
- `actor_user_id uuid null` — null means the system
- `event_type text not null`, checked against: `CREATED`, `SUPPORT_ADDED`, `SEVERITY_CONFIRMED`, `PRIORITY_SET`, `ASSIGNED`, `REASSIGNED`, `STATUS_CHANGED`, `RESOLVED`, `REJECTED`, `MERGED_INTO`, `MERGED_FROM`, `REOPENED`
- `from_status issue_status null`
- `to_status issue_status null`
- `note text null`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`

Trigger `issue_events_append_only`: `BEFORE UPDATE OR DELETE` always raises an exception. A statement-level `issue_events_no_truncate` trigger does the same for `TRUNCATE` (including `truncate issues cascade`). Both apply to the service role and superusers too. Demo reset rebuilds the database (`02` §14) instead of deleting rows.

### resolution_evidence
- `id uuid pk default gen_random_uuid()`
- `issue_id uuid not null references issues(id)`
- `uploaded_by uuid not null references users(id)`
- `image_path text not null`
- `note text null`
- `created_at timestamptz not null default now()`

### risk_zones
- `id uuid pk default gen_random_uuid()`
- `name text not null`
- `risk_value integer not null check (risk_value between 0 and 100)`
- `geom geography(Polygon,4326) not null`
- `reason text`
- `created_at timestamptz not null default now()`

### hotspots
- `id uuid pk default gen_random_uuid()`
- `category issue_category not null`
- `geom geography(Polygon,4326) not null`
- `current_issue_count integer not null`
- `baseline_issue_count integer not null`
- `expected_current_count numeric not null`
- `trend_percent numeric not null`
- `severity level not null`
- `explanation text not null`
- `window_start timestamptz not null`
- `window_end timestamptz not null`
- `active boolean not null`
- `generated_at timestamptz not null default now()`

### hotspot_issues — hotspot provenance
- `hotspot_id uuid references hotspots(id)`
- `issue_id uuid references issues(id)`
- primary key `(hotspot_id, issue_id)`

## 3. Functions
Shared rules for every function below:
- Defined `SECURITY DEFINER` with `set search_path = public, extensions` (PostGIS lives in `extensions`).
- EXECUTE is granted to `service_role` only. The first migration alters default privileges so that new functions in `public` are not executable by `PUBLIC`, `anon` or `authenticated`; still write `revoke ... from public, anon, authenticated` + `grant execute ... to service_role` explicitly on each function.
- **Exception:** `is_authority` is also granted to `anon` and `authenticated`, because RLS policies evaluate it as the querying role. It only answers a yes/no question.
- Each takes `p_actor_id` (already verified by the API route), re-checks authorisation, and writes its `issue_events` rows in the same transaction.
- Status changes happen **only** here.
- Errors: `raise exception using errcode = 'PT<http>', message = '<ERROR_CODES key>', detail = '<human-readable reason>'` — `PT400 VALIDATION_FAILED`, `PT403 FORBIDDEN`, `PT404 NOT_FOUND`, `PT409 CONFLICT` / `INVALID_TRANSITION`, `PT429 RATE_LIMITED`. PostgREST turns SQLSTATE `PTxyz` into HTTP xyz; supabase-js surfaces `{ code: 'PT429', message: 'RATE_LIMITED', details: '...' }`. A route maps it with `fail(message, <friendly message>)` when `code` matches `/^PT\d{3}$/` and `message` is an `ERROR_CODES` key; anything else is `INTERNAL` (logged).

| Function | Caller | Does |
|---|---|---|
| `is_authority(p_user_id) → boolean` | functions, RLS | Checks for a `users` row with role `AUTHORITY` |
| `check_report_rate_limit(p_actor_id, p_ip_hash, p_config) → void` | `create_report`, `add_supporting_report` | `02` §9: counts `reports` in the rolling `window_hours` per user and per IP hash (null hash skips the IP limit); raises `PT429 RATE_LIMITED` (detail `per-user limit` / `per-IP limit`) |
| `create_report(p_actor_id, p_ip_hash, p_category, p_citizen_severity, p_description, p_image_path, p_lat, p_lng, p_config) → jsonb` | citizen route | `p_image_path` must start with `{p_actor_id}/` (else `FORBIDDEN`) and exist in `report-photos` (else `VALIDATION_FAILED`); description trimmed, non-empty; rate limits (`02` §9); inserts issue + first report + `CREATED`; returns `{issue_id, report_id}` |
| `add_supporting_report(p_actor_id, p_ip_hash, p_issue_id, …same fields…)` | citizen route | Issue must be open; rate limits; inserts report + `SUPPORT_ADDED` |
| `duplicate_candidates(p_lat, p_lng, p_category, p_config)` | citizen route | Read only; `02` §3.3–3.5 |
| `status_transition_rules() → table(from_status, to_status, event_type, stretch)` | write functions, `check-transitions.ts` | Immutable; the one SQL copy of `02` §4, one row per (from, to) (no creation row); reopen rows have `stretch = true` and are not enforced until reopen ships. The write functions take the event type from the matching non-stretch row (helper `transition_event(p_from, p_to) → text`, else `PT409 INVALID_TRANSITION` detail `'<FROM> -> <TO> not allowed'`). `scripts/db-test/check-transitions.ts` asserts it equals `STATUS_TRANSITIONS` (`02` §15) |
| `set_priority(p_actor_id, p_issue_id, p_final_priority, p_authority_severity) → jsonb` | authority route | At least one value (else `VALIDATION_FAILED`); issue `REPORTED`/`ASSIGNED`/`IN_PROGRESS` (else `CONFLICT` `issue is closed`). An event only for a value that changes: `PRIORITY_SET` / `SEVERITY_CONFIRMED`, metadata `{from, to}`. Returns `{issue_id, status, updated_at, final_priority, authority_severity}` |
| `assign_issue(p_actor_id, p_issue_id, p_department_id) → jsonb` | authority route | Department must exist and be active (else `VALIDATION_FAILED`). `REPORTED` → `ASSIGNED` (`ASSIGNED`); `ASSIGNED`/`IN_PROGRESS` → `ASSIGNED` with a different department (`REASSIGNED`; same department → `CONFLICT`). Sets `assigned_at = now()`, `sla_due_at = assigned_at + sla_hours`; metadata `{department_id, previous_department_id}`. Returns `{issue_id, status, updated_at, event_type, department: {id, name}, assigned_at, sla_due_at}` |
| `transition_issue(p_actor_id, p_issue_id, p_to_status, p_note) → jsonb` | authority route (citizen for `REOPENED`, stretch) | `ASSIGNED` → `IN_PROGRESS` (`STATUS_CHANGED`); `REPORTED`/`ASSIGNED` → `REJECTED` (`REJECTED`, trimmed note required else `VALIDATION_FAILED`). Any other target → `INVALID_TRANSITION` (`REOPENED` until the stretch ships). Event carries the note. Returns `{issue_id, status, updated_at, from_status}` |
| `resolve_issue(p_actor_id, p_issue_id, p_image_path, p_note) → jsonb` | authority route | Issue `IN_PROGRESS` (else `INVALID_TRANSITION`); `p_image_path` must start with `{p_actor_id}/` (else `FORBIDDEN`) and exist in `resolution-photos` (else `VALIDATION_FAILED`). Evidence row + `RESOLVED` + `resolved_at`; event metadata `{evidence_id}`. Returns `{issue_id, status, updated_at, resolved_at, evidence: {id, note, created_at}}` (no image path) |
| `merge_issue(p_actor_id, p_source_id, p_target_id, p_note)` | authority route | `02` §3.7 |
| `authority_queue(p_config, p_filters jsonb) → jsonb` | authority route | Read only; a jsonb array, one element per issue whose status is in `p_filters.statuses` (default `p_config.queue_statuses`, the open statuses), filtered by `categories`, `department_id`, `unassigned_only`. Element: id, category, status, final_priority, effective_severity, severity_source, factors, score, label, distinct_reporter_count, recurrence_count, report_count, department `{id, name}` or null, sla_due_at, created_at, updated_at, is_seed, lat, lng — never reporter ids. **v1 (Phase 2):** factors, score, label, recurrence_count are null; sorted by final_priority (CRITICAL → LOW, then unset), then oldest first. Phase 4 fills the factors and sorts by score descending |
| `regenerate_city_pulse(p_config)` | report route via `after()`, regenerate route, reset script | `02` §6 |
| `map_issues(p_min_lng, p_min_lat, p_max_lng, p_max_lat, p_categories, p_statuses)` | public map route | Read only; table of map markers inside the bbox (`02` §12); never `REJECTED` or `MERGED`; a null array means no filter |
| `issue_detail(p_issue_id, p_viewer_id)` | public detail route | Read only; sanitised jsonb (no reporter/actor ids, IP hashes, metadata or storage paths; timeline actor is `CITIZEN`/`AUTHORITY`/`SYSTEM`) or null; a `REJECTED` issue only for an authority or a viewer with a report on it (mirrors §4). Photos are references: each report and evidence row has its `id` + `has_photo`, which the route turns into `/api/photos/{report\|evidence}/{id}` (`02` §10.2) |
| `my_reports(p_user_id)` | citizen route | Read only; jsonb array of the user's reports, newest first, each with its current issue (follows merges) and latest resolution evidence; photo references (`id` + `has_photo`) as in `issue_detail`, including for `REJECTED` issues (the caller reported them) |
| `photo_object(p_kind, p_id, p_viewer_id) → jsonb` | photo route | Read only; `p_kind` `report` → `{bucket: 'report-photos', path, public}` for that report, `evidence` → `resolution-photos` for that evidence row. Null for an unknown kind or id, or for a `REJECTED` issue unless the viewer is an authority or has a report on it (same rule as `issue_detail`). `public` is false for a `REJECTED` issue, so the route must not let shared caches keep the response |

## 4. Row-level security
RLS is enabled on every table. There are **no INSERT, UPDATE or DELETE policies**; all writes go through §3. As a second layer, `anon` and `authenticated` have their INSERT/UPDATE/DELETE/TRUNCATE table privileges revoked (SELECT stays, filtered by RLS).

SELECT policies:
| Table | Who can read |
|---|---|
| `issues` | rows with `status <> 'REJECTED'`; authority; or a caller who has a report on the issue. Realtime relies on this policy. |
| `reports` | `reporter_user_id = auth.uid()`, or authority |
| `issue_events`, `resolution_evidence` | authority only. Citizens get sanitised versions through the API. |
| `departments`, `risk_zones`, `hotspots`, `hotspot_issues` | everyone |
| `users` | own row, or authority |

- Storage bucket policies: `02` §10.2.
- The Realtime publication includes `issues` only.

## 5. Indexes
- GiST: `issues.geom`, `reports.geom`, `risk_zones.geom`, `hotspots.geom`
- btree:
  - `issues(status, category, created_at)`
  - `issues(merged_into_issue_id)`
  - `reports(issue_id, created_at)`
  - `reports(reporter_user_id, created_at)`
  - `reports(reporter_ip_hash, created_at)`
  - `issue_events(issue_id, created_at)`
  - `hotspots(active, generated_at)`

## 6. Not in the MVP
Service areas, SLA policy tables, upvotes, notifications, analytics snapshots and AI columns. Add each one in the migration that ships its feature.

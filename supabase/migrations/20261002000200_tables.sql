-- CivicPulse AI — Phase 0: tables (04 §2) and indexes (04 §5).

-- users — authority accounts. Citizens are anonymous auth users with no row here.
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  email      text not null,
  role       public.user_role not null default 'AUTHORITY',
  created_at timestamptz not null default now()
);

-- departments
create table public.departments (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  sla_hours          integer not null,                          -- seeded default: 02 §8
  default_categories public.issue_category[] not null default '{}', -- drives the assignment suggestion
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

-- issues — one physical problem. No stored score/factor/support count/title (02 §5.2).
create table public.issues (
  id                     uuid primary key default gen_random_uuid(),
  category               public.issue_category not null,
  status                 public.issue_status not null default 'REPORTED',
  citizen_severity       public.level null,  -- copied from the first report
  authority_severity     public.level null,
  final_priority         public.level null,
  geom                   extensions.geography(Point, 4326) not null, -- the first report's location
  assigned_department_id uuid null references public.departments (id),
  assigned_at            timestamptz null,
  sla_due_at             timestamptz null,
  merged_into_issue_id   uuid null references public.issues (id),
  is_seed                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  resolved_at            timestamptz null,

  constraint issues_merged_consistency_chk
    check ((status = 'MERGED') = (merged_into_issue_id is not null)),
  constraint issues_not_self_merged_chk
    check (merged_into_issue_id <> id),
  constraint issues_assigned_has_department_chk
    check (status not in ('ASSIGNED', 'IN_PROGRESS') or assigned_department_id is not null),
  constraint issues_resolved_has_resolved_at_chk
    check (status <> 'RESOLVED' or resolved_at is not null)
);

-- Keep issues.updated_at current on every UPDATE.
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger issues_touch_updated_at
  before update on public.issues
  for each row execute function public.touch_updated_at();

-- reports — one citizen submission. An issue's primary report is its earliest report.
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  issue_id         uuid not null references public.issues (id),
  reporter_user_id uuid not null, -- auth.uid(); no FK so seed rows can use fixed demo uuids
  reporter_ip_hash text null,
  category         public.issue_category not null, -- as the citizen chose it
  citizen_severity public.level null,
  description      text not null,
  image_path       text not null,
  geom             extensions.geography(Point, 4326) not null,
  created_at       timestamptz not null default now()
);

-- issue_events — append-only audit trail (trigger in ..._audit_authority.sql).
create table public.issue_events (
  id            uuid primary key default gen_random_uuid(),
  issue_id      uuid not null references public.issues (id),
  actor_user_id uuid null, -- null means the system
  event_type    text not null,
  from_status   public.issue_status null,
  to_status     public.issue_status null,
  note          text null,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),

  constraint issue_events_event_type_chk check (event_type in (
    'CREATED', 'SUPPORT_ADDED', 'SEVERITY_CONFIRMED', 'PRIORITY_SET', 'ASSIGNED', 'REASSIGNED',
    'STATUS_CHANGED', 'RESOLVED', 'REJECTED', 'MERGED_INTO', 'MERGED_FROM', 'REOPENED'
  ))
);

-- resolution_evidence
create table public.resolution_evidence (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references public.issues (id),
  uploaded_by uuid not null references public.users (id),
  image_path  text not null,
  note        text null,
  created_at  timestamptz not null default now()
);

-- risk_zones
create table public.risk_zones (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  risk_value integer not null check (risk_value between 0 and 100),
  geom       extensions.geography(Polygon, 4326) not null,
  reason     text,
  created_at timestamptz not null default now()
);

-- hotspots — City Pulse output (02 §6). Never seeded.
create table public.hotspots (
  id                     uuid primary key default gen_random_uuid(),
  category               public.issue_category not null,
  geom                   extensions.geography(Polygon, 4326) not null,
  current_issue_count    integer not null,
  baseline_issue_count   integer not null,
  expected_current_count numeric not null,
  trend_percent          numeric not null,
  severity               public.level not null,
  explanation            text not null,
  window_start           timestamptz not null,
  window_end             timestamptz not null,
  active                 boolean not null,
  generated_at           timestamptz not null default now()
);

-- hotspot_issues — hotspot provenance
create table public.hotspot_issues (
  hotspot_id uuid references public.hotspots (id),
  issue_id   uuid references public.issues (id),
  primary key (hotspot_id, issue_id)
);

-- Indexes (04 §5) ---------------------------------------------------------------------------
create index issues_geom_gix       on public.issues     using gist (geom);
create index reports_geom_gix      on public.reports    using gist (geom);
create index risk_zones_geom_gix   on public.risk_zones using gist (geom);
create index hotspots_geom_gix     on public.hotspots   using gist (geom);

create index issues_status_category_created_at_idx on public.issues (status, category, created_at);
create index issues_merged_into_issue_id_idx       on public.issues (merged_into_issue_id);
create index reports_issue_id_created_at_idx         on public.reports (issue_id, created_at);
create index reports_reporter_user_id_created_at_idx on public.reports (reporter_user_id, created_at);
create index reports_reporter_ip_hash_created_at_idx on public.reports (reporter_ip_hash, created_at);
create index issue_events_issue_id_created_at_idx  on public.issue_events (issue_id, created_at);
create index hotspots_active_generated_at_idx      on public.hotspots (active, generated_at);

-- CivicPulse AI — Phase 0: row-level security (04 §4).
-- RLS on every table. SELECT policies only: there are NO insert/update/delete policies, because
-- every write goes through a service_role database function (02 §7.3, 04 §3).
-- `(select auth.uid())` / `(select public.is_authority(...))` are evaluated once per statement
-- (initPlan) instead of once per row.

alter table public.users               enable row level security;
alter table public.departments         enable row level security;
alter table public.issues              enable row level security;
alter table public.reports             enable row level security;
alter table public.issue_events        enable row level security;
alter table public.resolution_evidence enable row level security;
alter table public.risk_zones          enable row level security;
alter table public.hotspots            enable row level security;
alter table public.hotspot_issues      enable row level security;

-- issues: not REJECTED; or authority; or the caller has a report on it. Realtime relies on this.
create policy issues_select on public.issues
  for select to anon, authenticated
  using (
    status <> 'REJECTED'
    or (select public.is_authority((select auth.uid())))
    or exists (
      select 1 from public.reports r
      where r.issue_id = issues.id
        and r.reporter_user_id = (select auth.uid())
    )
  );

-- reports: own reports, or authority
create policy reports_select on public.reports
  for select to authenticated
  using (
    reporter_user_id = (select auth.uid())
    or (select public.is_authority((select auth.uid())))
  );

-- issue_events, resolution_evidence: authority only (citizens get sanitised versions via the API)
create policy issue_events_select on public.issue_events
  for select to authenticated
  using ((select public.is_authority((select auth.uid()))));

create policy resolution_evidence_select on public.resolution_evidence
  for select to authenticated
  using ((select public.is_authority((select auth.uid()))));

-- departments, risk_zones, hotspots, hotspot_issues: everyone
create policy departments_select    on public.departments    for select to anon, authenticated using (true);
create policy risk_zones_select     on public.risk_zones     for select to anon, authenticated using (true);
create policy hotspots_select       on public.hotspots       for select to anon, authenticated using (true);
create policy hotspot_issues_select on public.hotspot_issues for select to anon, authenticated using (true);

-- users: own row, or authority
create policy users_select on public.users
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_authority((select auth.uid())))
  );

-- Belt and braces: Supabase grants ALL on public tables to anon/authenticated by default.
-- RLS already blocks writes; also remove the privileges (SELECT stays, filtered by RLS).
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;

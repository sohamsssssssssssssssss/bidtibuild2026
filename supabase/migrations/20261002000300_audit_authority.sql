-- CivicPulse AI — Phase 0: append-only audit trail (04 §2 issue_events) and is_authority (04 §3).

-- issue_events is append-only for everyone, including service_role and superusers (06 rule 19).
-- Enforced by triggers, not grants, so no role can opt out. Demo reset rebuilds the database
-- (02 §14) instead of deleting rows.
create function public.issue_events_append_only()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  raise exception 'issue_events is append-only: % is not allowed', tg_op
    using errcode = 'P0001',
          hint = 'Write a new issue_events row instead; demo reset rebuilds the database.';
end;
$$;

create trigger issue_events_append_only
  before update or delete on public.issue_events
  for each row execute function public.issue_events_append_only();

-- TRUNCATE skips row triggers, so block it with a statement-level trigger
-- (this also stops `truncate issues cascade`).
create trigger issue_events_no_truncate
  before truncate on public.issue_events
  for each statement execute function public.issue_events_append_only();

-- is_authority — authority means a users row with role AUTHORITY (02 §7.2), never the
-- `authenticated` role. SECURITY DEFINER so RLS policies can call it without exposing `users`.
create function public.is_authority(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.users u
    where u.id = p_user_id and u.role = 'AUTHORITY'
  );
$$;

-- Exception to the service_role-only rule (04 §3): RLS policies evaluate it as the querying
-- role, so anon and authenticated need EXECUTE. It only answers a yes/no question.
revoke all on function public.is_authority(uuid) from public;
grant execute on function public.is_authority(uuid) to anon, authenticated, service_role;

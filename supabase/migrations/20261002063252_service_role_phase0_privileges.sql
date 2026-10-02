-- Phase 0 direct Data API access for the server-only service_role client.
-- A valid service_role JWT bypasses RLS, but still needs PostgreSQL object grants.
grant usage on schema public to service_role;

-- demo:reset upserts the authority row (INSERT ... ON CONFLICT DO UPDATE) and
-- reads it back through PostgREST.
grant select, insert, update on table public.users to service_role;

-- demo:reset counts seeded issues/hotspots directly. Other reads and writes use
-- existing service_role-only SECURITY DEFINER functions with explicit EXECUTE grants.
grant select on table public.issues, public.hotspots to service_role;

-- All current IDs use UUID defaults; there are no application sequences to grant.
-- Future tables need explicit grants in their own migrations when direct access is added.

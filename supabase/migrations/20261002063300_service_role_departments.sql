-- GET /api/departments reads active departments directly with the server-only service_role
-- client (02 §13). Follows 20261002063252_service_role_phase0_privileges.sql: a service_role JWT
-- bypasses RLS but still needs the PostgreSQL object grant on projects without default grants.
grant select on table public.departments to service_role;

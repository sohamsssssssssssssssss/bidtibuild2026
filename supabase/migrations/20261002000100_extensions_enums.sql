-- CivicPulse AI — Phase 0: extensions, function privilege defaults, enums (04 §1).

-- PostGIS lives in the `extensions` schema on Supabase. Anything that resolves PostGIS
-- types/functions with a pinned search_path must therefore use `public, extensions`.
create extension if not exists postgis with schema extensions;

-- Function privilege hygiene (02 §7.3, 04 §3).
-- Write functions trust their p_actor_id argument, so they must be callable by service_role only.
-- Supabase grants EXECUTE on new public functions to anon/authenticated (per-schema default),
-- and Postgres grants EXECUTE to PUBLIC globally. Remove both so that every function created
-- after this point is executable by its owner + service_role only, unless granted explicitly
-- (is_authority does this, because RLS policies call it as the querying role).
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- A per-schema REVOKE cannot cancel the *global* PUBLIC default, so revoke that one globally too.
-- Caveat: this also covers functions of extensions created later by this role; grant those
-- explicitly if one is ever added (PostGIS above is created before this and is unaffected).
alter default privileges revoke execute on functions from public;

-- 02 §3.1
create type public.issue_category as enum (
  'POTHOLE',
  'STREETLIGHT',
  'GARBAGE',
  'WATER_LEAK',
  'DRAINAGE',
  'WATERLOGGING',
  'FOOTPATH',
  'PUBLIC_PROPERTY',
  'OTHER'
);

-- 02 §4. REOPENED is used only once the reopen stretch ships.
create type public.issue_status as enum (
  'REPORTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'REJECTED',
  'MERGED',
  'REOPENED'
);

-- Severity, final priority and hotspot severity.
create type public.level as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

create type public.user_role as enum ('AUTHORITY');

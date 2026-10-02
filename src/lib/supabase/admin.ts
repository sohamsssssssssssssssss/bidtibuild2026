/**
 * Service-role Supabase client — SERVER ONLY (06 rule 27, 02 §7.4).
 *
 * Bypasses RLS and can execute the service_role-only database functions
 * (02 §7.3). Import it only from route handlers / server code. The
 * `server-only` package is not installed, so a runtime check below throws if
 * this module is ever evaluated in a browser bundle; the key itself is never
 * exposed because it has no NEXT_PUBLIC_ prefix.
 *
 * Created lazily on first use so `next build` works without env vars.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/api/env";

if (typeof window !== "undefined") {
  throw new Error("src/lib/supabase/admin.ts is server-only and must not be imported in the browser");
}

let adminClient: SupabaseClient | undefined;

export function getAdminClient(): SupabaseClient {
  adminClient ??= createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  return adminClient;
}

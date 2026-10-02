/**
 * Request-scoped Supabase client bound to the Next.js cookie store (anon key).
 * Route handlers use it only to identify the caller with `auth.getUser()`
 * (02 §7.3); every read/write then goes through the service-role client and a
 * database function. Create one per request — never share it.
 *
 * The browser client and the session-refresh proxy/middleware are Soham's
 * (WORK_SPLIT Phase 0) and live elsewhere.
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requiredEnv } from "@/lib/api/env";

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Route handlers may set cookies (token refresh). Server Components cannot; there the
        // throw is harmless because the proxy/middleware refreshes the session.
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          /* called from a Server Component */
        }
      },
    },
  });
}

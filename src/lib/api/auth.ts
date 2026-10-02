/**
 * Caller identity (02 §7). Citizens are Supabase anonymous users — they ARE
 * users (02 §7.1). Authority comes only from a `users` row, checked with
 * `is_authority`, never from the `authenticated` role (02 §7.2, 06 rule 24).
 */
import { isAuthApiError, isAuthSessionMissingError, type User } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callRpc } from "./db";
import { ApiRouteError } from "./respond";

export interface Caller {
  user: User;
}

/**
 * The verified caller, or null when there is no valid session. Uses the
 * session cookies; an `Authorization: Bearer <access token>` header is also
 * accepted (scripts, E2E). Either way the token is verified by Supabase Auth
 * with `getUser()`, never just decoded.
 */
export async function getCaller(req: Request): Promise<Caller | null> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const { data, error } = bearer
    ? await getAdminClient().auth.getUser(bearer)
    : await (await createSupabaseServerClient()).auth.getUser();
  if (error) {
    // No session / invalid or expired token → anonymous caller. Anything else (Auth down) → INTERNAL.
    if (isAuthSessionMissingError(error) || (isAuthApiError(error) && error.status < 500)) return null;
    throw error;
  }
  return data.user ? { user: data.user } : null;
}

export async function requireUser(req: Request): Promise<Caller> {
  const caller = await getCaller(req);
  if (!caller) throw new ApiRouteError("UNAUTHENTICATED", "Please sign in to continue.");
  return caller;
}

export async function isAuthority(userId: string): Promise<boolean> {
  return (await callRpc("is_authority", { p_user_id: userId })) === true;
}

export async function requireAuthority(req: Request): Promise<Caller> {
  const caller = await requireUser(req);
  if (!(await isAuthority(caller.user.id))) throw new ApiRouteError("FORBIDDEN", "Authority access required.");
  return caller;
}

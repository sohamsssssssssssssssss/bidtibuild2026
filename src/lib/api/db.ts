import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Calls a service_role-only database function (02 §7.3) and returns its raw
 * result: a `returns table` function gives an array of row objects, a
 * `returns jsonb` function gives the JSON value itself (or null). Callers
 * validate it with `parseDbResult`. Errors are thrown (→ INTERNAL) with the
 * PostgREST error attached for the server log.
 */
export async function callRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) throw new Error(`rpc ${fn} failed: ${error.code ?? ""} ${error.message}`, { cause: error });
  return data;
}

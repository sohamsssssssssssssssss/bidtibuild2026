import { getAdminClient } from "@/lib/supabase/admin";
import { mapDbError, type DbErrorMessages } from "./db-errors";

export interface CallRpcOptions {
  /** Friendly client messages per API code for errors raised per the DB error convention (db-errors.ts). */
  errors?: DbErrorMessages;
}

/**
 * Calls a service_role-only database function (02 §7.3) and returns its raw
 * result: a `returns table` function gives an array of row objects, a
 * `returns jsonb` function gives the JSON value itself (or null). Callers
 * validate it with `parseDbResult`.
 *
 * Errors raised per the convention (`PT<http>` + an ERROR_CODES key) become an
 * `ApiRouteError` with a friendly message (`opts.errors` or the defaults).
 * Anything else is thrown (→ INTERNAL) with the PostgREST error attached for
 * the server log.
 */
export async function callRpc(fn: string, args: Record<string, unknown>, opts: CallRpcOptions = {}): Promise<unknown> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (error) {
    throw (
      mapDbError(fn, error, opts.errors) ??
      new Error(`rpc ${fn} failed: ${error.code ?? ""} ${error.message}`, { cause: error })
    );
  }
  return data;
}

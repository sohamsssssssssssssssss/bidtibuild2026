/**
 * Database error convention (all phases): SQL → PostgREST → route.
 *
 * Write functions raise
 *   raise exception using errcode = 'PT<http>', message = '<ERROR_CODES key>', detail = '<reason>';
 * PostgREST turns SQLSTATE PTxyz into HTTP xyz and supabase-js surfaces
 * `{ code: 'PT429', message: 'RATE_LIMITED', details: '...' }`.
 *
 * A matching error becomes an `ApiRouteError` with that code and a FRIENDLY
 * message chosen here or by the route. The DB `detail` is logged server-side
 * and only reaches the client when a route explicitly maps it to its own text.
 * Anything else (including a PT500 INTERNAL) stays an unmapped error → INTERNAL.
 */
import { ERROR_CODES, type ErrorCode } from "@/contracts/envelope";
import { ApiRouteError } from "./respond";

/** The fields of a PostgREST error we rely on (structurally a supabase-js `PostgrestError`). */
export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/** Friendly client message for a code: fixed text, or chosen from the (server-side) DB detail. */
export type DbErrorMessage = string | ((detail: string) => string);
export type DbErrorMessages = Partial<Record<ErrorCode, DbErrorMessage>>;

/** 02 §9 — same text whether the per-user or the per-IP limit was hit. */
export const RATE_LIMITED_MESSAGE = "You've sent a lot of reports in the last hour. Please try again a little later.";

/** Defaults used when a route gives no message for a code. Never echo DB details. */
export const DEFAULT_DB_ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "Some of the details aren't valid. Please check them and try again.",
  UNAUTHENTICATED: "Please sign in to continue.",
  FORBIDDEN: "You're not allowed to do that.",
  NOT_FOUND: "We couldn't find that.",
  CONFLICT: "That change conflicts with the latest state. Please refresh and try again.",
  INVALID_TRANSITION: "That status change isn't allowed.",
  RATE_LIMITED: RATE_LIMITED_MESSAGE,
  INTERNAL: "Something went wrong. Please try again.",
  NOT_IMPLEMENTED: "That isn't available yet.",
};

const PT_CODE = /^PT\d{3}$/;

function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CODES, value);
}

/** The API code a DB error maps to under the convention, or null (→ INTERNAL). */
export function apiCodeForDbError(err: DbErrorLike): ErrorCode | null {
  const { code, message } = err;
  if (!code || !message || !PT_CODE.test(code) || !isErrorCode(message)) return null;
  return message === "INTERNAL" ? null : message;
}

/**
 * Maps a DB error per the convention to an `ApiRouteError`, or returns null
 * when it doesn't follow the convention (callers then throw it as INTERNAL).
 * `fn` is only used for the server log.
 */
export function mapDbError(fn: string, err: DbErrorLike, messages: DbErrorMessages = {}): ApiRouteError | null {
  const code = apiCodeForDbError(err);
  if (!code) return null;
  const detail = err.details ?? "";
  console.warn(`[db] ${fn} → ${code} (${err.code})${detail ? `: ${detail}` : ""}`);
  const message = messages[code] ?? DEFAULT_DB_ERROR_MESSAGES[code];
  return new ApiRouteError(code, typeof message === "function" ? message(detail) : message);
}

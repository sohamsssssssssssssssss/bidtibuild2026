/**
 * API response envelope (02 §13):
 *   { data: T | null, error: { code: string, message: string } | null }
 *
 * Exactly one of `data` / `error` is non-null. Successful responses always
 * carry non-null `data` (use an empty array/object rather than null).
 */
import { z } from "zod";

/** Error code → HTTP status. Routes must respond with this status for the code. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  /** Write conflicts, e.g. issue no longer open, same department on reassign, merge into self. */
  CONFLICT: 409,
  /** Status change not allowed by 02 §4. */
  INVALID_TRANSITION: 409,
  /** 02 §9 — friendly message required. */
  RATE_LIMITED: 429,
  INTERNAL: 500,
  /** Phase-0 stubs and stretch features behind a flag (e.g. REOPENED). */
  NOT_IMPLEMENTED: 501,
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_VALUES = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];
export const errorCodeSchema = z.enum(ERROR_CODE_VALUES);

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export type ApiSuccess<T> = { data: T; error: null };
export type ApiFailure = { data: null; error: ApiError };
/** Assignable to the spec shape `{ data: T | null, error: ApiError | null }`. */
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Zod schema for an envelope wrapping `data`. Useful in clients and tests. */
export function apiEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.union([
    z.object({ data, error: z.null() }),
    z.object({ data: z.null(), error: apiErrorSchema }),
  ]);
}

export function ok<T>(data: T): ApiSuccess<T> {
  return { data, error: null };
}

export function fail(code: ErrorCode, message: string): ApiFailure {
  return { data: null, error: { code, message } };
}

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CODES[code];
}

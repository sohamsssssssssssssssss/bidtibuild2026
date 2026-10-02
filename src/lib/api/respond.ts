/** Envelope responses (02 §13) with the HTTP status that matches the error code. */
import { fail, httpStatusFor, ok, type ErrorCode } from "@/contracts/envelope";

/** Thrown inside a handler to answer with an error envelope; `withApi` turns it into a Response. */
export class ApiRouteError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiRouteError";
  }
}

export function respondOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(ok(data), { status: 200, ...init });
}

export function respondFail(code: ErrorCode, message: string): Response {
  return Response.json(fail(code, message), { status: httpStatusFor(code) });
}

const PHASES = {
  1: "Phase 1 — Citizen slice",
  2: "Phase 2 — Authority workflow",
  3: "Phase 3 — Duplicates",
  4: "Phase 4 — Recommended priority",
  5: "Phase 5 — City Pulse",
} as const;

/** 501 stub for a route that a later phase implements (docs/WORK_SPLIT.md). */
export function notImplemented(route: string, phase: keyof typeof PHASES): Response {
  return respondFail("NOT_IMPLEMENTED", `${route} is not implemented yet (${PHASES[phase]}).`);
}

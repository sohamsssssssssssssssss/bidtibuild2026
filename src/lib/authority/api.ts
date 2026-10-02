/**
 * Browser client for the authority routes (02 §13). Every call goes to the
 * same-origin API with the Supabase session cookie; responses are parsed with
 * the canonical envelope + response schemas so the UI never trusts a shape
 * the contract does not define. Writes resolve only with the server's result.
 */
import { z } from "zod";
import type { Category, Level, StatusPatchTarget } from "../../config/civic";
import { apiEnvelopeSchema, type ErrorCode } from "../../contracts/envelope";
import {
  authorityQueueResponseSchema,
  type AuthorityQueueQuery,
} from "../../contracts/authority";
import { departmentsResponseSchema } from "../../contracts/departments";
import {
  hotspotsResponseSchema,
  regenerateHotspotsResponseSchema,
} from "../../contracts/hotspots";
import {
  assignIssueResponseSchema,
  issueDetailResponseSchema,
  mergeIssueResponseSchema,
  resolveIssueResponseSchema,
  setPriorityResponseSchema,
  transitionIssueResponseSchema,
} from "../../contracts/issues";
import { duplicateCandidatesResponseSchema } from "../../contracts/reports";

export class AuthorityApiError extends Error {
  readonly code: ErrorCode | "NETWORK" | "BAD_RESPONSE";
  readonly status: number;

  constructor(
    message: string,
    code: ErrorCode | "NETWORK" | "BAD_RESPONSE",
    status: number,
  ) {
    super(message);
    this.name = "AuthorityApiError";
    this.code = code;
    this.status = status;
  }
}

async function call<T extends z.ZodType>(
  url: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: init?.body
        ? { "Content-Type": "application/json", ...init.headers }
        : init?.headers,
    });
  } catch {
    throw new AuthorityApiError(
      "Network error. Check your connection and retry.",
      "NETWORK",
      0,
    );
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AuthorityApiError(
      `Unexpected response (${response.status}).`,
      "BAD_RESPONSE",
      response.status,
    );
  }
  const parsed = apiEnvelopeSchema(schema).safeParse(json);
  if (!parsed.success) {
    throw new AuthorityApiError(
      "The server returned an unexpected response.",
      "BAD_RESPONSE",
      response.status,
    );
  }
  const envelope = parsed.data as {
    data: z.infer<T> | null;
    error: { code: ErrorCode; message: string } | null;
  };
  if (!response.ok || envelope.error || envelope.data === null) {
    throw new AuthorityApiError(
      envelope.error?.message ?? `Request failed (${response.status}).`,
      envelope.error?.code ?? "INTERNAL",
      response.status,
    );
  }
  return envelope.data;
}

function send(method: "POST" | "PATCH", body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export function queueUrl(q: AuthorityQueueQuery = {}): string {
  const sp = new URLSearchParams();
  q.status?.forEach((s) => sp.append("status", s));
  q.category?.forEach((c) => sp.append("category", c));
  if (q.department_id) sp.set("department_id", q.department_id);
  const qs = sp.toString();
  return `/api/authority/queue${qs ? `?${qs}` : ""}`;
}

const id = (issueId: string) => encodeURIComponent(issueId);

export const authorityApi = {
  queue: (q?: AuthorityQueueQuery) =>
    call(queueUrl(q), authorityQueueResponseSchema),
  departments: () => call("/api/departments", departmentsResponseSchema),
  /** GET /api/hotspots — the active City Pulse hotspots (02 §6). */
  hotspots: () => call("/api/hotspots", hotspotsResponseSchema),
  /** POST /api/hotspots/regenerate — authority only; returns the new active set. */
  regenerateHotspots: () =>
    call("/api/hotspots/regenerate", regenerateHotspotsResponseSchema, {
      method: "POST",
    }),
  issue: (issueId: string) =>
    call(`/api/issues/${id(issueId)}`, issueDetailResponseSchema),
  duplicateCandidates: (lat: number, lng: number, category: Category) =>
    call(
      `/api/duplicate-candidates?${new URLSearchParams({ lat: String(lat), lng: String(lng), category })}`,
      duplicateCandidatesResponseSchema,
    ),
  setPriority: (
    issueId: string,
    body: { final_priority?: Level; authority_severity?: Level },
  ) =>
    call(
      `/api/issues/${id(issueId)}/priority`,
      setPriorityResponseSchema,
      send("PATCH", body),
    ),
  assign: (issueId: string, departmentId: string) =>
    call(
      `/api/issues/${id(issueId)}/assign`,
      assignIssueResponseSchema,
      send("POST", { department_id: departmentId }),
    ),
  transition: (issueId: string, toStatus: StatusPatchTarget, note?: string) =>
    call(
      `/api/issues/${id(issueId)}/status`,
      transitionIssueResponseSchema,
      send("PATCH", { to_status: toStatus, note }),
    ),
  resolve: (issueId: string, imagePath: string, note?: string) =>
    call(
      `/api/issues/${id(issueId)}/resolution`,
      resolveIssueResponseSchema,
      send("POST", { image_path: imagePath, note }),
    ),
  merge: (sourceIssueId: string, targetIssueId: string, note?: string) =>
    call(
      `/api/issues/${id(sourceIssueId)}/merge`,
      mergeIssueResponseSchema,
      send("POST", { target_issue_id: targetIssueId, note }),
    ),
};

import type { z } from "zod";
import type { Category } from "@/config/civic";
import { apiEnvelopeSchema } from "@/contracts/envelope";
import {
  duplicateCandidatesResponseSchema,
  reportWriteResultSchema,
  type CreateReportBody,
  type DuplicateCandidate,
  type ReportWriteResult,
} from "@/contracts/reports";

/** An error whose message is safe to show to a citizen as-is. */
export class FriendlyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "FriendlyError";
  }
}

export const NETWORK_MESSAGE =
  "We couldn't reach the server. Check your connection and try again.";
export const RATE_LIMIT_MESSAGE =
  "You've sent a lot of reports recently. Please wait a little while and try again.";
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/** Server messages that are already written for citizens (validation details are not). */
function messageFor(status: number, code?: string, message?: string): string {
  if (status === 429 || code === "RATE_LIMITED") return RATE_LIMIT_MESSAGE;
  if (status === 401 || code === "UNAUTHENTICATED")
    return "Your session expired. Please try again.";
  if (status >= 500 || !message) return GENERIC_MESSAGE;
  if (code === "VALIDATION_FAILED" && /^Invalid /.test(message))
    return "Some of the report details aren't valid. Please check them and try again.";
  return message;
}

async function request<T extends z.ZodType>(
  url: string,
  init: RequestInit,
  data: T,
  successStatus: number,
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store" });
  } catch {
    throw new FriendlyError(NETWORK_MESSAGE);
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON response: handled below by status.
  }
  const parsed = apiEnvelopeSchema(data).safeParse(json);
  if (!parsed.success) {
    throw new FriendlyError(messageFor(response.status), response.status);
  }
  const envelope = parsed.data as
    | { data: z.infer<T>; error: null }
    | { data: null; error: { code: string; message: string } };
  if (envelope.error || response.status !== successStatus) {
    throw new FriendlyError(
      messageFor(
        response.status,
        envelope.error?.code,
        envelope.error?.message,
      ),
      response.status,
      envelope.error?.code,
    );
  }
  return envelope.data as z.infer<T>;
}

export function fetchDuplicateCandidates(query: {
  lat: number;
  lng: number;
  category: Category;
}): Promise<DuplicateCandidate[]> {
  const params = new URLSearchParams({
    lat: String(query.lat),
    lng: String(query.lng),
    category: query.category,
  });
  return request(
    `/api/duplicate-candidates?${params.toString()}`,
    { method: "GET" },
    duplicateCandidatesResponseSchema,
    200,
  );
}

const jsonPost = (body: CreateReportBody): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** POST /api/reports — confirmed only with 201 and created_new_issue === true. */
export async function createReport(
  body: CreateReportBody,
): Promise<ReportWriteResult> {
  const result = await request(
    "/api/reports",
    jsonPost(body),
    reportWriteResultSchema,
    201,
  );
  if (!result.created_new_issue)
    throw new FriendlyError("Could not confirm your report. Please retry.");
  return result;
}

/** POST /api/issues/:id/support — confirmed only with 201 and a valid write result. */
export function supportIssue(
  issueId: string,
  body: CreateReportBody,
): Promise<ReportWriteResult> {
  return request(
    `/api/issues/${encodeURIComponent(issueId)}/support`,
    jsonPost(body),
    reportWriteResultSchema,
    201,
  );
}

export function successUrl(result: ReportWriteResult): string {
  const params = new URLSearchParams({
    issue: result.issue_id,
    report: result.report_id,
  });
  if (!result.created_new_issue) params.set("supported", "1");
  return `/report/success?${params.toString()}`;
}

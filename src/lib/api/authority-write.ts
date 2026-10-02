/**
 * Shared by the Phase 2 authority routes (02 §4, §7.3, §13):
 *   PATCH /api/issues/:id/priority    → set_priority(...)
 *   POST  /api/issues/:id/assign      → assign_issue(...)
 *   PATCH /api/issues/:id/status      → transition_issue(...)
 *   POST  /api/issues/:id/resolution  → resolve_issue(...)
 *
 * Friendly client messages per error code for each write function. The DB
 * `detail` is logged server-side (db-errors.ts) and never echoed.
 */
import type { z } from "zod";
import { resolveIssueResponseSchema, type ResolveIssueResponse } from "@/contracts/issues";
import { resolutionEvidenceSchema } from "@/contracts/primitives";
import type { DbErrorMessages } from "./db-errors";
import { photoUrl } from "./storage";

export const ISSUE_NOT_FOUND_MESSAGE = "Issue not found.";
export const AUTHORITY_REQUIRED_MESSAGE = "Authority access required.";
export const REOPEN_NOT_ENABLED_MESSAGE = "Reopening is not enabled yet.";
export const RESOLUTION_PHOTO_FORBIDDEN_MESSAGE = "That photo wasn't uploaded by this account.";
export const RESOLUTION_PHOTO_NOT_FOUND_MESSAGE =
  "We couldn't find the uploaded resolution photo. Please upload it again.";

/** set_priority: PT404 missing issue, PT409 CONFLICT closed issue, PT400 nothing to set. */
export const SET_PRIORITY_ERRORS: DbErrorMessages = {
  FORBIDDEN: AUTHORITY_REQUIRED_MESSAGE,
  NOT_FOUND: ISSUE_NOT_FOUND_MESSAGE,
  CONFLICT: "This issue is closed and can no longer be re-prioritised.",
  VALIDATION_FAILED: "Provide a final priority, an authority severity, or both.",
};

/** assign_issue: PT400 unknown/inactive department, PT409 CONFLICT same department, PT409 INVALID_TRANSITION. */
export const ASSIGN_ISSUE_ERRORS: DbErrorMessages = {
  FORBIDDEN: AUTHORITY_REQUIRED_MESSAGE,
  NOT_FOUND: ISSUE_NOT_FOUND_MESSAGE,
  CONFLICT: "The issue is already assigned to that department.",
  INVALID_TRANSITION: "This issue can't be assigned from its current status.",
  VALIDATION_FAILED: "That department doesn't exist or is no longer active.",
};

/** transition_issue: PT409 INVALID_TRANSITION, PT400 missing rejection reason. */
export const TRANSITION_ISSUE_ERRORS: DbErrorMessages = {
  FORBIDDEN: AUTHORITY_REQUIRED_MESSAGE,
  NOT_FOUND: ISSUE_NOT_FOUND_MESSAGE,
  INVALID_TRANSITION: "That status change isn't allowed from the issue's current status.",
  VALIDATION_FAILED: "Please give a reason for this status change.",
};

/** resolve_issue: PT409 not IN_PROGRESS, PT403 foreign photo path, PT400 photo missing from storage. */
export const RESOLVE_ISSUE_ERRORS: DbErrorMessages = {
  FORBIDDEN: RESOLUTION_PHOTO_FORBIDDEN_MESSAGE,
  NOT_FOUND: ISSUE_NOT_FOUND_MESSAGE,
  INVALID_TRANSITION: "Only an issue that is in progress can be marked resolved.",
  VALIDATION_FAILED: (detail) =>
    /photo not found/i.test(detail)
      ? RESOLUTION_PHOTO_NOT_FOUND_MESSAGE
      : "Some of the resolution details aren't valid. Please check them and try again.",
};

/** jsonb returned by resolve_issue: the response minus the evidence `image_url` (the route builds it). */
export const resolveIssueRowSchema = resolveIssueResponseSchema.extend({
  evidence: resolutionEvidenceSchema.omit({ image_url: true }),
});
export type ResolveIssueRow = z.infer<typeof resolveIssueRowSchema>;

export function toResolveIssueResponse(row: ResolveIssueRow): ResolveIssueResponse {
  return { ...row, evidence: { ...row.evidence, image_url: photoUrl("evidence", row.evidence.id) } };
}

/**
 * Shared by the Phase 3 duplicate routes (02 §3.3–3.7, §13):
 *   GET  /api/duplicate-candidates → duplicate_candidates(...)
 *   POST /api/issues/:id/merge     → merge_issue(...)
 * (POST /api/issues/:id/support lives with the other report writes in report-write.ts.)
 */
import { z } from "zod";
import { duplicateCandidateSchema, type DuplicateCandidatesResponse } from "@/contracts/reports";
import { uuidSchema } from "@/contracts/primitives";
import { AUTHORITY_REQUIRED_MESSAGE, ISSUE_NOT_FOUND_MESSAGE } from "./authority-write";
import type { DbErrorMessages } from "./db-errors";
import { photoUrl } from "./storage";

/**
 * jsonb array returned by duplicate_candidates: the response element with
 * `primary_report_id` (earliest report) in place of `image_url`.
 */
export const duplicateCandidateRowsSchema = z.array(
  duplicateCandidateSchema.omit({ image_url: true }).extend({ primary_report_id: uuidSchema }),
);
export type DuplicateCandidateRows = z.infer<typeof duplicateCandidateRowsSchema>;

/**
 * Builds each candidate's primary photo URL. Candidates are always open issues
 * (never REJECTED), so their photos are public (02 §10.3).
 */
export function toDuplicateCandidates(rows: DuplicateCandidateRows): DuplicateCandidatesResponse {
  return rows.map(({ primary_report_id, ...rest }) => ({
    ...rest,
    image_url: photoUrl("report", primary_report_id),
  }));
}

export const MERGE_SELF_MESSAGE = "Pick a different issue to merge into.";

/** merge_issue: PT403, PT400 self-merge, PT404, PT409 INVALID_TRANSITION (source) / CONFLICT (target closed). */
export const MERGE_ISSUE_ERRORS: DbErrorMessages = {
  FORBIDDEN: AUTHORITY_REQUIRED_MESSAGE,
  NOT_FOUND: ISSUE_NOT_FOUND_MESSAGE,
  INVALID_TRANSITION: "This issue can't be merged from its current status.",
  CONFLICT: "The target issue is closed.",
  VALIDATION_FAILED: MERGE_SELF_MESSAGE,
};

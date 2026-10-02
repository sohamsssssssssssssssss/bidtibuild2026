/**
 * Shared by the two report-writing routes (02 §9, §10.2):
 *   POST /api/reports             → create_report(...)
 *   POST /api/issues/:id/support  → add_supporting_report(..., p_issue_id, ...)  (Phase 3)
 */
import { z } from "zod";
import { DUPLICATE_CONFIG, RATE_LIMIT_CONFIG } from "@/config/civic";
import { imagePathBelongsTo, uuidSchema } from "@/contracts/primitives";
import type { CreateReportBody } from "@/contracts/reports";
import { ISSUE_NOT_FOUND_MESSAGE } from "./authority-write";
import { RATE_LIMITED_MESSAGE, type DbErrorMessages } from "./db-errors";
import { ApiRouteError } from "./respond";

/** Route check (02 §10.2): the photo must be under the caller's uid. SQL re-checks it and that the object exists. */
export function assertOwnImagePath(imagePath: string, userId: string): void {
  if (!imagePathBelongsTo(imagePath, userId)) {
    throw new ApiRouteError("FORBIDDEN", "That photo doesn't belong to this session.");
  }
}

/** Named rpc args common to both write functions. Never hard-codes the limits: p_config carries them. */
export function reportWriteArgs(actorId: string, ipHash: string, body: CreateReportBody): Record<string, unknown> {
  return {
    p_actor_id: actorId,
    p_ip_hash: ipHash,
    p_category: body.category,
    p_citizen_severity: body.citizen_severity,
    p_description: body.description,
    p_image_path: body.image_path,
    p_lat: body.lat,
    p_lng: body.lng,
    p_config: RATE_LIMIT_CONFIG,
  };
}

/**
 * add_supporting_report args: the shared ones plus the target issue. p_config
 * also carries the compatible families so SQL never hard-codes them.
 */
export function supportWriteArgs(
  actorId: string,
  ipHash: string,
  issueId: string,
  body: CreateReportBody,
): Record<string, unknown> {
  return {
    ...reportWriteArgs(actorId, ipHash, body),
    p_issue_id: issueId,
    p_config: { ...RATE_LIMIT_CONFIG, compatible_families: DUPLICATE_CONFIG.compatible_families },
  };
}

/** jsonb returned by both write functions. */
export const reportWriteRowSchema = z.object({ issue_id: uuidSchema, report_id: uuidSchema });
export type ReportWriteRow = z.infer<typeof reportWriteRowSchema>;

export const PHOTO_NOT_FOUND_MESSAGE = "We couldn't find your uploaded photo. Please try uploading it again.";

/** Friendly messages for errors the write functions raise (DB details are logged, not sent). */
export const REPORT_WRITE_ERRORS: DbErrorMessages = {
  RATE_LIMITED: RATE_LIMITED_MESSAGE,
  FORBIDDEN: "That photo doesn't belong to this session.",
  VALIDATION_FAILED: (detail) =>
    /photo not found/i.test(detail)
      ? PHOTO_NOT_FOUND_MESSAGE
      : "Some of the report details aren't valid. Please check them and try again.",
};

export const SUPPORT_ISSUE_CLOSED_MESSAGE =
  "This issue is already closed, so it can't take new reports. Please create a new issue instead.";
export const SUPPORT_CATEGORY_MISMATCH_MESSAGE = "That category doesn't match this issue.";

/** add_supporting_report: the create_report errors plus PT404 missing issue, PT409 closed issue, PT400 category mismatch. */
export const SUPPORT_WRITE_ERRORS: DbErrorMessages = {
  ...REPORT_WRITE_ERRORS,
  NOT_FOUND: ISSUE_NOT_FOUND_MESSAGE,
  CONFLICT: SUPPORT_ISSUE_CLOSED_MESSAGE,
  VALIDATION_FAILED: (detail) =>
    /category does not match/i.test(detail)
      ? SUPPORT_CATEGORY_MISMATCH_MESSAGE
      : /photo not found/i.test(detail)
        ? PHOTO_NOT_FOUND_MESSAGE
        : "Some of the report details aren't valid. Please check them and try again.",
};

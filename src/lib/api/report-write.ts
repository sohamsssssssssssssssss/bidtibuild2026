/**
 * Shared by the two report-writing routes (02 §9, §10.2):
 *   POST /api/reports             → create_report(...)
 *   POST /api/issues/:id/support  → add_supporting_report(..., p_issue_id, ...)  (Phase 3)
 */
import { z } from "zod";
import { RATE_LIMIT_CONFIG } from "@/config/civic";
import { imagePathBelongsTo, uuidSchema } from "@/contracts/primitives";
import type { CreateReportBody } from "@/contracts/reports";
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

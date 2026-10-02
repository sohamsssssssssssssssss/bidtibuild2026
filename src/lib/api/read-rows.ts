/**
 * Shapes returned by the read functions (20261002000700_read_functions.sql),
 * derived from the response contracts: identical except that photos carry the
 * storage `image_path` (nullable) instead of the public `image_url`.
 */
import { z } from "zod";
import { issueDetailSchema, issuePhotoSchema } from "@/contracts/issues";
import { resolutionEvidenceSchema } from "@/contracts/primitives";
import { myReportIssueSummarySchema, myReportSchema } from "@/contracts/reports";
import { STORAGE_BUCKETS } from "@/config/civic";
import type { IssueDetail } from "@/contracts/issues";
import type { MyReport } from "@/contracts/reports";
import { withImageUrl } from "./storage";

const imagePath = { image_path: z.string().nullable() };

const evidenceRowSchema = resolutionEvidenceSchema.omit({ image_url: true }).extend(imagePath);

/** `issue_detail(p_issue_id, p_viewer_id)` → jsonb object or null. */
export const issueDetailRowSchema = issueDetailSchema.extend({
  photos: z.array(issuePhotoSchema.omit({ image_url: true }).extend(imagePath)),
  resolution_evidence: z.array(evidenceRowSchema),
});
export type IssueDetailRow = z.infer<typeof issueDetailRowSchema>;

/** `my_reports(p_user_id)` → jsonb array. */
export const myReportsRowSchema = z.array(
  myReportSchema.omit({ image_url: true }).extend({
    ...imagePath,
    issue: myReportIssueSummarySchema.extend({ latest_resolution_evidence: evidenceRowSchema.nullable() }),
  }),
);
export type MyReportsRow = z.infer<typeof myReportsRowSchema>;

export function toIssueDetail(row: IssueDetailRow): IssueDetail {
  return {
    ...row,
    photos: row.photos.map((p) => withImageUrl(p, STORAGE_BUCKETS.reportPhotos)),
    resolution_evidence: row.resolution_evidence.map((e) => withImageUrl(e, STORAGE_BUCKETS.resolutionPhotos)),
  };
}

export function toMyReports(rows: MyReportsRow): MyReport[] {
  return rows.map((r) => {
    const evidence = r.issue.latest_resolution_evidence;
    return {
      ...withImageUrl(r, STORAGE_BUCKETS.reportPhotos),
      issue: {
        ...r.issue,
        latest_resolution_evidence: evidence && withImageUrl(evidence, STORAGE_BUCKETS.resolutionPhotos),
      },
    };
  });
}

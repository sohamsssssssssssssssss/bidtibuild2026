/**
 * Shapes returned by the read functions (issue_detail / my_reports, last
 * replaced in 20261002000900_photo_route.sql), derived from the response
 * contracts: identical except that each report / evidence row carries
 * `has_photo` instead of `image_url`. The route turns that into the photo
 * route path keyed by the row's id (02 §10.2) — storage paths never leave the
 * database, because they embed the uploader's uid (06 rule 22).
 */
import { z } from "zod";
import { issueDetailSchema, issuePhotoSchema } from "@/contracts/issues";
import { resolutionEvidenceSchema } from "@/contracts/primitives";
import { myReportIssueSummarySchema, myReportSchema } from "@/contracts/reports";
import type { IssueDetail } from "@/contracts/issues";
import type { MyReport } from "@/contracts/reports";
import { photoUrl } from "./storage";

const photoRef = { has_photo: z.boolean() };

const evidenceRowSchema = resolutionEvidenceSchema.omit({ image_url: true }).extend(photoRef);

/** `issue_detail(p_issue_id, p_viewer_id)` → jsonb object or null. */
export const issueDetailRowSchema = issueDetailSchema.extend({
  photos: z.array(issuePhotoSchema.omit({ image_url: true }).extend(photoRef)),
  resolution_evidence: z.array(evidenceRowSchema),
});
export type IssueDetailRow = z.infer<typeof issueDetailRowSchema>;

/** `my_reports(p_user_id)` → jsonb array. */
export const myReportsRowSchema = z.array(
  myReportSchema.omit({ image_url: true }).extend({
    ...photoRef,
    issue: myReportIssueSummarySchema.extend({ latest_resolution_evidence: evidenceRowSchema.nullable() }),
  }),
);
export type MyReportsRow = z.infer<typeof myReportsRowSchema>;

/** Replaces a row's `has_photo` with `image_url` (null when hidden, 02 §10.3). `id` is the report / evidence id. */
function withPhotoUrl<T extends { id: string; has_photo: boolean }>(
  row: T,
  kind: "report" | "evidence",
): Omit<T, "has_photo"> & { image_url: string | null } {
  const { has_photo, ...rest } = row;
  return { ...rest, image_url: has_photo ? photoUrl(kind, row.id) : null };
}

export function toIssueDetail(row: IssueDetailRow): IssueDetail {
  return {
    ...row,
    photos: row.photos.map((p) => withPhotoUrl(p, "report")),
    resolution_evidence: row.resolution_evidence.map((e) => withPhotoUrl(e, "evidence")),
  };
}

export function toMyReports(rows: MyReportsRow): MyReport[] {
  return rows.map((r) => {
    const evidence = r.issue.latest_resolution_evidence;
    return {
      ...withPhotoUrl(r, "report"),
      issue: {
        ...r.issue,
        latest_resolution_evidence: evidence && withPhotoUrl(evidence, "evidence"),
      },
    };
  });
}

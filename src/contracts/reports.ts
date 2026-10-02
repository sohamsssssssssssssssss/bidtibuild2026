/**
 * Citizen report routes:
 *   POST /api/reports                 — new issue + first report
 *   POST /api/issues/:id/support      — supporting report on an existing issue
 *   GET  /api/duplicate-candidates    — 02 §3.3–3.5
 *   GET  /api/my-reports              — caller's reports with their current issue
 *
 * Privacy (06 §22): no reporter_user_id, reporter_ip_hash or citizen actor ids.
 */
import { z } from "zod";
import { DUPLICATE_CONFIG } from "../config/civic";
import {
  categorySchema,
  descriptionSchema,
  imagePathSchema,
  imageUrlSchema,
  isoDateTimeSchema,
  issueIdParamsSchema,
  issueStatusSchema,
  latSchema,
  levelSchema,
  lngSchema,
  queryLatSchema,
  queryLngSchema,
  resolutionEvidenceSchema,
  uuidSchema,
} from "./primitives";

// ---------------------------------------------------------------------------
// POST /api/reports
// ---------------------------------------------------------------------------

/**
 * JSON body. `image_path` is the object path in the `report-photos` bucket;
 * the route checks it starts with the caller's uid and that the object exists.
 * `citizen_severity` may be omitted or null.
 */
export const createReportBodySchema = z.object({
  category: categorySchema,
  citizen_severity: levelSchema.nullish().transform((v) => v ?? null),
  description: descriptionSchema,
  image_path: imagePathSchema,
  lat: latSchema,
  lng: lngSchema,
});
export type CreateReportBody = z.infer<typeof createReportBodySchema>;
export type CreateReportBodyInput = z.input<typeof createReportBodySchema>;

/**
 * Response for both report-writing routes.
 * `created_new_issue` is always true for POST /api/reports and false for
 * POST /api/issues/:id/support.
 */
export const reportWriteResultSchema = z.object({
  issue_id: uuidSchema,
  report_id: uuidSchema,
  created_new_issue: z.boolean(),
});
export type ReportWriteResult = z.infer<typeof reportWriteResultSchema>;

export const createReportResponseSchema = reportWriteResultSchema;
export type CreateReportResponse = ReportWriteResult;

// ---------------------------------------------------------------------------
// POST /api/issues/:id/support
// ---------------------------------------------------------------------------

export const supportReportParamsSchema = issueIdParamsSchema;
export type SupportReportParams = z.infer<typeof supportReportParamsSchema>;

/** Same body as POST /api/reports (02 §13). SQL checks the issue is open. */
export const supportReportBodySchema = createReportBodySchema;
export type SupportReportBody = CreateReportBody;

export const supportReportResponseSchema = reportWriteResultSchema;
export type SupportReportResponse = ReportWriteResult;

// ---------------------------------------------------------------------------
// GET /api/duplicate-candidates?lat=..&lng=..&category=..
// ---------------------------------------------------------------------------

export const duplicateCandidatesQuerySchema = z.object({
  lat: queryLatSchema,
  lng: queryLngSchema,
  category: categorySchema,
});
export type DuplicateCandidatesQuery = z.infer<typeof duplicateCandidatesQuerySchema>;

/** EXACT = same category; FAMILY = compatible family (02 §3.4). No confidence score (06 §30). */
export const DUPLICATE_MATCH_KINDS = ["EXACT", "FAMILY"] as const;
export const duplicateMatchSchema = z.enum(DUPLICATE_MATCH_KINDS);
export type DuplicateMatch = z.infer<typeof duplicateMatchSchema>;

export const duplicateCandidateSchema = z.object({
  id: uuidSchema,
  category: categorySchema,
  status: issueStatusSchema,
  distance_m: z.number().nonnegative(),
  report_count: z.number().int().positive(),
  /** Primary (earliest) report's photo. */
  image_url: imageUrlSchema,
  created_at: isoDateTimeSchema,
  match: duplicateMatchSchema,
  lat: latSchema,
  lng: lngSchema,
});
export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

/** Ranked: EXACT before FAMILY, then distance asc, then newest first (02 §3.5). */
export const duplicateCandidatesResponseSchema = z
  .array(duplicateCandidateSchema)
  .max(DUPLICATE_CONFIG.max_candidates);
export type DuplicateCandidatesResponse = z.infer<typeof duplicateCandidatesResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/my-reports  (no input; caller from session)
// ---------------------------------------------------------------------------

/** Current state of the issue a report belongs to (follows merges, 02 §3.7). */
export const myReportIssueSummarySchema = z.object({
  id: uuidSchema,
  status: issueStatusSchema,
  category: categorySchema,
  final_priority: levelSchema.nullable(),
  report_count: z.number().int().positive(),
  updated_at: isoDateTimeSchema,
  resolved_at: isoDateTimeSchema.nullable(),
  /** Most recent resolution evidence, if any. */
  latest_resolution_evidence: resolutionEvidenceSchema.nullable(),
});
export type MyReportIssueSummary = z.infer<typeof myReportIssueSummarySchema>;

export const myReportSchema = z.object({
  id: uuidSchema,
  category: categorySchema,
  citizen_severity: levelSchema.nullable(),
  description: z.string(),
  /** The caller's own photo; null when the issue is REJECTED (02 §10.3). */
  image_url: imageUrlSchema,
  lat: latSchema,
  lng: lngSchema,
  created_at: isoDateTimeSchema,
  issue: myReportIssueSummarySchema,
});
export type MyReport = z.infer<typeof myReportSchema>;

/** Newest report first. */
export const myReportsResponseSchema = z.array(myReportSchema);
export type MyReportsResponse = z.infer<typeof myReportsResponseSchema>;

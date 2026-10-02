/**
 * Issue routes:
 *   GET   /api/issues                    — public map markers
 *   GET   /api/issues/:id                — public detail
 *   PATCH /api/issues/:id/priority       — authority
 *   POST  /api/issues/:id/assign         — authority
 *   PATCH /api/issues/:id/status         — authority (citizen for REOPENED, stretch)
 *   POST  /api/issues/:id/resolution     — authority
 *   POST  /api/issues/:id/merge          — authority
 *
 * Privacy (06 §22, 02 §7.4, §10.2–10.3): public responses never include
 * reporter_user_id, reporter_ip_hash or actor ids. `image_url` is the photo
 * route path (`/api/photos/{report|evidence}/{id}`), never a Storage path/URL
 * (those embed the uploader's uid). A REJECTED issue — and its photos — is
 * visible only to authorities and to its own reporters; the photo route
 * enforces the same rule.
 */
import { z } from "zod";
import { MAP_STATUSES, NOTE_REQUIRED_STATUSES, STATUS_PATCH_TARGETS, type IssueStatus } from "../config/civic";
import {
  categorySchema,
  departmentRefSchema,
  eventTypeSchema,
  imagePathSchema,
  imageUrlSchema,
  isoDateTimeSchema,
  issueIdParamsSchema,
  issueStatusSchema,
  latSchema,
  levelSchema,
  lngSchema,
  optionalNoteSchema,
  queryArray,
  queryBboxSchema,
  resolutionEvidenceSchema,
  uuidSchema,
} from "./primitives";

// ---------------------------------------------------------------------------
// GET /api/issues?bbox=minLng,minLat,maxLng,maxLat&category=..&status=..
// ---------------------------------------------------------------------------

export const mapStatusSchema = z.enum(MAP_STATUSES);

/**
 * `bbox` is required. `category` / `status` are optional arrays (repeated or
 * comma list; see primitives.ts). Omitted `status` means every MAP_STATUSES
 * value. REJECTED and MERGED issues are never returned.
 */
export const issuesQuerySchema = z.object({
  bbox: queryBboxSchema,
  category: queryArray(categorySchema),
  status: queryArray(mapStatusSchema),
});
export type IssuesQuery = z.infer<typeof issuesQuerySchema>;

export const issueMarkerSchema = z.object({
  id: uuidSchema,
  category: categorySchema,
  status: issueStatusSchema,
  lat: latSchema,
  lng: lngSchema,
  final_priority: levelSchema.nullable(),
  report_count: z.number().int().positive(),
  created_at: isoDateTimeSchema,
  is_seed: z.boolean(),
});
export type IssueMarker = z.infer<typeof issueMarkerSchema>;

/** Plain array; the client builds the GeoJSON FeatureCollection for MapLibre. */
export const issuesResponseSchema = z.array(issueMarkerSchema);
export type IssuesResponse = z.infer<typeof issuesResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/issues/:id
// ---------------------------------------------------------------------------

export const issueDetailParamsSchema = issueIdParamsSchema;
export type IssueDetailParams = z.infer<typeof issueDetailParamsSchema>;

/** A report as shown publicly (primary report first, then oldest → newest). */
export const issuePhotoSchema = z.object({
  /** Report id. */
  id: uuidSchema,
  image_url: imageUrlSchema,
  description: z.string(),
  category: categorySchema,
  citizen_severity: levelSchema.nullable(),
  created_at: isoDateTimeSchema,
});
export type IssuePhoto = z.infer<typeof issuePhotoSchema>;

/** Actor kind instead of an actor id: AUTHORITY if `is_authority(actor)`, SYSTEM if null, else CITIZEN. */
export const TIMELINE_ACTORS = ["CITIZEN", "AUTHORITY", "SYSTEM"] as const;
export const timelineActorSchema = z.enum(TIMELINE_ACTORS);
export type TimelineActor = z.infer<typeof timelineActorSchema>;

/** Sanitised `issue_events` row: no actor id, no metadata. Oldest first. */
export const timelineEventSchema = z.object({
  id: uuidSchema,
  event_type: eventTypeSchema,
  from_status: issueStatusSchema.nullable(),
  to_status: issueStatusSchema.nullable(),
  note: z.string().nullable(),
  actor: timelineActorSchema,
  created_at: isoDateTimeSchema,
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const issueDetailSchema = z.object({
  id: uuidSchema,
  category: categorySchema,
  status: issueStatusSchema,
  citizen_severity: levelSchema.nullable(),
  authority_severity: levelSchema.nullable(),
  final_priority: levelSchema.nullable(),
  lat: latSchema,
  lng: lngSchema,
  department: departmentRefSchema.nullable(),
  assigned_at: isoDateTimeSchema.nullable(),
  sla_due_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  resolved_at: isoDateTimeSchema.nullable(),
  /** Set when status is MERGED; the UI should follow it to the target. */
  merged_into_issue_id: uuidSchema.nullable(),
  is_seed: z.boolean(),
  report_count: z.number().int().nonnegative(),
  photos: z.array(issuePhotoSchema),
  timeline: z.array(timelineEventSchema),
  /** Oldest first. */
  resolution_evidence: z.array(resolutionEvidenceSchema),
});
export type IssueDetail = z.infer<typeof issueDetailSchema>;

export const issueDetailResponseSchema = issueDetailSchema;
export type IssueDetailResponse = IssueDetail;

// ---------------------------------------------------------------------------
// Shared mutation result
// ---------------------------------------------------------------------------

/** Base of every authority mutation response: the issue's state after the write. */
export const issueMutationResultSchema = z.object({
  issue_id: uuidSchema,
  status: issueStatusSchema,
  updated_at: isoDateTimeSchema,
});
export type IssueMutationResult = z.infer<typeof issueMutationResultSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/issues/:id/priority
// ---------------------------------------------------------------------------

export const setPriorityParamsSchema = issueIdParamsSchema;
export type SetPriorityParams = z.infer<typeof setPriorityParamsSchema>;

/** Sets either or both (at least one). Values cannot be cleared to null. */
export const setPriorityBodySchema = z
  .object({
    final_priority: levelSchema.optional(),
    authority_severity: levelSchema.optional(),
  })
  .refine((b) => b.final_priority !== undefined || b.authority_severity !== undefined, {
    message: "Provide final_priority, authority_severity, or both",
  });
export type SetPriorityBody = z.infer<typeof setPriorityBodySchema>;

export const setPriorityResponseSchema = issueMutationResultSchema.extend({
  final_priority: levelSchema.nullable(),
  authority_severity: levelSchema.nullable(),
});
export type SetPriorityResponse = z.infer<typeof setPriorityResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/issues/:id/assign
// ---------------------------------------------------------------------------

export const assignIssueParamsSchema = issueIdParamsSchema;
export type AssignIssueParams = z.infer<typeof assignIssueParamsSchema>;

/** Assign (REPORTED → ASSIGNED) or reassign to a different department (02 §4). */
export const assignIssueBodySchema = z.object({ department_id: uuidSchema });
export type AssignIssueBody = z.infer<typeof assignIssueBodySchema>;

export const assignIssueResponseSchema = issueMutationResultSchema.extend({
  event_type: z.enum(["ASSIGNED", "REASSIGNED"]),
  department: departmentRefSchema,
  assigned_at: isoDateTimeSchema,
  sla_due_at: isoDateTimeSchema,
});
export type AssignIssueResponse = z.infer<typeof assignIssueResponseSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/issues/:id/status
// ---------------------------------------------------------------------------

export const transitionIssueParamsSchema = issueIdParamsSchema;
export type TransitionIssueParams = z.infer<typeof transitionIssueParamsSchema>;

export const statusPatchTargetSchema = z.enum(STATUS_PATCH_TARGETS);

/**
 * `to_status`: IN_PROGRESS | REJECTED | REOPENED. A note (reason) is required
 * for REJECTED and REOPENED (02 §4), optional otherwise. REOPENED passes
 * validation but the route answers NOT_IMPLEMENTED while FEATURES.reopen is
 * false. Whether the transition is allowed from the current status is
 * checked in SQL (→ INVALID_TRANSITION).
 */
export const transitionIssueBodySchema = z
  .object({
    to_status: statusPatchTargetSchema,
    note: optionalNoteSchema,
  })
  .refine(
    (b) => b.note !== undefined || !(NOTE_REQUIRED_STATUSES as readonly IssueStatus[]).includes(b.to_status),
    { message: "A reason is required for this status", path: ["note"] },
  );
export type TransitionIssueBody = z.infer<typeof transitionIssueBodySchema>;

export const transitionIssueResponseSchema = issueMutationResultSchema.extend({
  from_status: issueStatusSchema,
});
export type TransitionIssueResponse = z.infer<typeof transitionIssueResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/issues/:id/resolution
// ---------------------------------------------------------------------------

export const resolveIssueParamsSchema = issueIdParamsSchema;
export type ResolveIssueParams = z.infer<typeof resolveIssueParamsSchema>;

/**
 * `image_path` is in the `resolution-photos` bucket and must start with the
 * authority's uid. `note` is optional (resolution_evidence.note is nullable).
 */
export const resolveIssueBodySchema = z.object({
  image_path: imagePathSchema,
  note: optionalNoteSchema,
});
export type ResolveIssueBody = z.infer<typeof resolveIssueBodySchema>;

export const resolveIssueResponseSchema = issueMutationResultSchema.extend({
  status: z.literal("RESOLVED"),
  resolved_at: isoDateTimeSchema,
  evidence: resolutionEvidenceSchema,
});
export type ResolveIssueResponse = z.infer<typeof resolveIssueResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/issues/:id/merge   (:id is the SOURCE)
// ---------------------------------------------------------------------------

export const mergeIssueParamsSchema = issueIdParamsSchema;
export type MergeIssueParams = z.infer<typeof mergeIssueParamsSchema>;

/**
 * The route must reject `target_issue_id === :id` (CONFLICT) before calling
 * SQL; `merge_issue` re-checks. `note` is optional (02 §4 requires no reason).
 */
export const mergeIssueBodySchema = z.object({
  target_issue_id: uuidSchema,
  note: optionalNoteSchema,
});
export type MergeIssueBody = z.infer<typeof mergeIssueBodySchema>;

export const mergeIssueResponseSchema = z.object({
  source_issue_id: uuidSchema,
  target_issue_id: uuidSchema,
  moved_report_ids: z.array(uuidSchema),
});
export type MergeIssueResponse = z.infer<typeof mergeIssueResponseSchema>;

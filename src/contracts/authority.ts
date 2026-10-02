/**
 * GET /api/authority/queue — authority only; wraps `authority_queue(p_config, p_filters)`.
 */
import { z } from "zod";
import { OPEN_STATUSES } from "../config/civic";
import {
  categorySchema,
  departmentRefSchema,
  isoDateTimeSchema,
  issueStatusSchema,
  latSchema,
  levelSchema,
  lngSchema,
  queryArray,
  severitySourceSchema,
  uuidSchema,
} from "./primitives";

/** `department_id=unassigned` filters to issues with no department. */
export const DEPARTMENT_FILTER_UNASSIGNED = "unassigned";

export const openStatusSchema = z.enum(OPEN_STATUSES);

/**
 * Query: `status` and `category` are optional arrays (repeated or comma list);
 * `department_id` is a single uuid or `unassigned`. Omitted `status` means
 * PRIORITY_CONFIG.queue_statuses (every open status).
 */
export const authorityQueueQuerySchema = z.object({
  status: queryArray(openStatusSchema),
  category: queryArray(categorySchema),
  department_id: z.union([uuidSchema, z.literal(DEPARTMENT_FILTER_UNASSIGNED)]).optional(),
});
export type AuthorityQueueQuery = z.infer<typeof authorityQueueQuerySchema>;

/**
 * The `p_filters jsonb` argument of `authority_queue`. null = no filter on
 * that dimension. `unassigned_only` true ⇒ `department_id` is null.
 */
export const authorityQueueFiltersSchema = z.object({
  statuses: z.array(openStatusSchema).nullable(),
  categories: z.array(categorySchema).nullable(),
  department_id: uuidSchema.nullable(),
  unassigned_only: z.boolean(),
});
export type AuthorityQueueFilters = z.infer<typeof authorityQueueFiltersSchema>;

export function toAuthorityQueueFilters(q: AuthorityQueueQuery): AuthorityQueueFilters {
  const unassigned = q.department_id === DEPARTMENT_FILTER_UNASSIGNED;
  return {
    statuses: q.status ?? null,
    categories: q.category ?? null,
    department_id: unassigned ? null : (q.department_id ?? null),
    unassigned_only: unassigned,
  };
}

/** 02 §5.4–§5.8 factor values, each 0–100. */
export const priorityFactorsSchema = z.object({
  severity: z.number(),
  support: z.number(),
  age: z.number(),
  location_risk: z.number(),
  recurrence: z.number(),
});
export type PriorityFactors = z.infer<typeof priorityFactorsSchema>;

/**
 * One row per open issue.
 *
 * Phase 4 (recommended priority, 02 §5): `factors`, `score`, `label` and
 * `recurrence_count` are always filled, computed at read time; factors and
 * score are rounded to 2 decimals (score from the unrounded factors), and
 * rows are sorted by score descending, then `created_at` ascending, then id.
 * `label` is `priorityLabel(score)` (02 §5.9); it is a recommendation only and
 * never becomes `final_priority`.
 *
 * The four fields stay nullable on purpose: if recommended priority is cut
 * (05 §4), the queue falls back to v1 (Phase 2: sorted by final priority, then
 * age), which returns them as **null**. The keys are always present.
 */
export const authorityQueueRowSchema = z.object({
  id: uuidSchema,
  category: categorySchema,
  status: issueStatusSchema,
  final_priority: levelSchema.nullable(),
  effective_severity: levelSchema,
  severity_source: severitySourceSchema,
  factors: priorityFactorsSchema.nullable(),
  score: z.number().nullable(),
  label: levelSchema.nullable(),
  /** Distinct reporters (the support factor's input). A count only — never ids. */
  distinct_reporter_count: z.number().int().nonnegative(),
  /** Resolved same-category issues nearby in the recurrence window (§5.8). */
  recurrence_count: z.number().int().nonnegative().nullable(),
  report_count: z.number().int().nonnegative(),
  department: departmentRefSchema.nullable(),
  sla_due_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  is_seed: z.boolean(),
  lat: latSchema,
  lng: lngSchema,
});
export type AuthorityQueueRow = z.infer<typeof authorityQueueRowSchema>;

export const authorityQueueResponseSchema = z.array(authorityQueueRowSchema);
export type AuthorityQueueResponse = z.infer<typeof authorityQueueResponseSchema>;

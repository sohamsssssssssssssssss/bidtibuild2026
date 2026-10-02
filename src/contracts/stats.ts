/**
 * GET /api/stats/resolution — public (02 §13). How long issues take to get resolved, per
 * category: a demo card for "can citizens see progress?" (01 §1). Counts only — no ids.
 */
import { z } from "zod";
import { categorySchema, isoDateTimeSchema } from "./primitives";

export const resolutionStatsRowSchema = z.object({
  category: categorySchema,
  /** Issues of this category resolved within the window (by `resolved_at`). */
  resolved_count: z.number().int().nonnegative(),
  /** Mean hours from `created_at` to `resolved_at`, 1 decimal; null when resolved_count is 0. */
  avg_resolution_hours: z.number().nonnegative().nullable(),
  /** Median of the same durations; null when resolved_count is 0. */
  median_resolution_hours: z.number().nonnegative().nullable(),
  /** How many of resolved_count are seeded demo issues (06 rule 2: label demo data). */
  demo_resolved_count: z.number().int().nonnegative(),
  /** Issues of this category open right now (REPORTED / ASSIGNED / IN_PROGRESS). */
  open_count: z.number().int().nonnegative(),
});
export type ResolutionStatsRow = z.infer<typeof resolutionStatsRowSchema>;

export const resolutionStatsResponseSchema = z.object({
  window_days: z.number().int().positive(),
  generated_at: isoDateTimeSchema,
  /** One row per category, in CATEGORIES order, including categories with no data. */
  categories: z.array(resolutionStatsRowSchema),
});
export type ResolutionStatsResponse = z.infer<typeof resolutionStatsResponseSchema>;

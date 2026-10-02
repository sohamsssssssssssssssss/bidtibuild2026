/**
 * City Pulse (02 §6):
 *   GET  /api/hotspots             — public; active hotspots
 *   POST /api/hotspots/regenerate  — authority; runs `regenerate_city_pulse`
 */
import { z } from "zod";
import { categorySchema, isoDateTimeSchema, latSchema, levelSchema, lngSchema, uuidSchema } from "./primitives";

/** GeoJSON position `[lng, lat]` (extra ordinates tolerated, as GeoJSON allows). */
export const geoJsonPositionSchema = z.tuple([lngSchema, latSchema], z.number());

/** GeoJSON Polygon (RFC 7946), e.g. from `ST_AsGeoJSON(geom)::jsonb`. Rings are closed. */
export const geoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(geoJsonPositionSchema).min(4)).min(1),
});
export type GeoJsonPolygon = z.infer<typeof geoJsonPolygonSchema>;

export const hotspotSchema = z.object({
  id: uuidSchema,
  category: categorySchema,
  severity: levelSchema,
  geometry: geoJsonPolygonSchema,
  current_issue_count: z.number().int().nonnegative(),
  baseline_issue_count: z.number().int().nonnegative(),
  expected_current_count: z.number().nonnegative(),
  trend_percent: z.number(),
  explanation: z.string(),
  window_start: isoDateTimeSchema,
  window_end: isoDateTimeSchema,
  generated_at: isoDateTimeSchema,
  /** Every cluster member (the whole 8 h input), from `hotspot_issues`. */
  member_issue_ids: z.array(uuidSchema),
});
export type Hotspot = z.infer<typeof hotspotSchema>;

// GET /api/hotspots — no input.
export const hotspotsResponseSchema = z.array(hotspotSchema);
export type HotspotsResponse = z.infer<typeof hotspotsResponseSchema>;

// POST /api/hotspots/regenerate — no body.
/** The new active set, so the UI can redraw without refetching. */
export const regenerateHotspotsResponseSchema = z.object({
  generated_at: isoDateTimeSchema,
  hotspots: z.array(hotspotSchema),
});
export type RegenerateHotspotsResponse = z.infer<typeof regenerateHotspotsResponseSchema>;

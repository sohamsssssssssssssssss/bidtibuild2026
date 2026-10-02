/**
 * Shared Zod primitives for the API contracts.
 *
 * Conventions:
 * - Timestamps are ISO-8601 strings with an offset, as Postgres/PostgREST
 *   returns them (e.g. "2026-10-02T10:00:00.123456+00:00").
 * - Ids are uuids. We use `z.guid()` (any 8-4-4-4-12 hex) rather than
 *   `z.uuid()` (RFC variant/version bits) because Postgres accepts any hex
 *   uuid and seed data may use fixed, non-RFC ids.
 * - Query strings: every value arrives as a string; the `query*` schemas coerce.
 *   Array params accept repeated keys AND comma lists, with or without a `[]`
 *   suffix: `?category=POTHOLE&category=GARBAGE`, `?category[]=POTHOLE`,
 *   `?category=POTHOLE,GARBAGE`. Convert URLSearchParams with
 *   `searchParamsToObject()` before parsing so repeated keys are kept.
 * - Photo URLs: responses carry `image_url` — a same-origin photo route path
 *   (`/api/photos/report/<report id>` or `/api/photos/evidence/<evidence id>`)
 *   built server-side — never a storage path or Storage URL, which would embed
 *   the uploader's uid (02 §10.2, 06 rule 22). `null` when hidden (REJECTED
 *   issue, for viewers who are neither an authority nor one of its reporters).
 */
import { z } from "zod";
import {
  CATEGORIES,
  EVENT_TYPES,
  ISSUE_STATUSES,
  LEVELS,
  SEVERITY_SOURCES,
  TEXT_LIMITS,
} from "../config/civic";

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

export const uuidSchema = z.guid();

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const latSchema = z.number().min(-90).max(90);
export const lngSchema = z.number().min(-180).max(180);

// ---------------------------------------------------------------------------
// Enums (values from civic.ts)
// ---------------------------------------------------------------------------

export const categorySchema = z.enum(CATEGORIES);
export const issueStatusSchema = z.enum(ISSUE_STATUSES);
export const levelSchema = z.enum(LEVELS);
export const eventTypeSchema = z.enum(EVENT_TYPES);
export const severitySourceSchema = z.enum(SEVERITY_SOURCES);

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export const descriptionSchema = z
  .string()
  .trim()
  .min(TEXT_LIMITS.description.min)
  .max(TEXT_LIMITS.description.max);

export const noteSchema = z.string().trim().min(TEXT_LIMITS.note.min).max(TEXT_LIMITS.note.max);

/** Optional note: missing, null, "" or whitespace all become `undefined`. */
export const optionalNoteSchema = z.preprocess(
  (v) => (v === null || (typeof v === "string" && v.trim() === "") ? undefined : v),
  noteSchema.optional(),
);

// ---------------------------------------------------------------------------
// Storage paths (02 §10.2)
// ---------------------------------------------------------------------------

const HEX_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `{uid}/{uuid}.jpg`, lowercase hex (auth uids and crypto.randomUUID() are lowercase). */
export const IMAGE_PATH_REGEX = new RegExp(`^${HEX_UUID}/${HEX_UUID}\\.jpg$`);

export const imagePathSchema = z.string().regex(IMAGE_PATH_REGEX, "Expected {uid}/{uuid}.jpg");

/** Route check (02 §10.2): the path must start with the caller's uid. Object existence is checked separately. */
export function imagePathBelongsTo(path: string, uid: string): boolean {
  return path.startsWith(`${uid.toLowerCase()}/`);
}

// ---------------------------------------------------------------------------
// Photo route (02 §10.2, §13): GET /api/photos/:kind/:id
// ---------------------------------------------------------------------------

/** `report` → a report's photo (id = report id); `evidence` → a resolution_evidence photo. */
export const PHOTO_KINDS = ["report", "evidence"] as const;
export const photoKindSchema = z.enum(PHOTO_KINDS);
export type PhotoKind = z.infer<typeof photoKindSchema>;

export const photoParamsSchema = z.object({ kind: photoKindSchema, id: uuidSchema });
export type PhotoParams = z.infer<typeof photoParamsSchema>;

/** `/api/photos/(report|evidence)/<uuid>` — relative, same origin as the API. */
export const PHOTO_URL_REGEX = new RegExp(`^/api/photos/(${PHOTO_KINDS.join("|")})/${HEX_UUID}$`, "i");

/** Photo route path built server-side (src/lib/api/storage.ts `photoUrl`); null when the photo is hidden. */
export const imageUrlSchema = z.string().regex(PHOTO_URL_REGEX, "Expected /api/photos/{kind}/{id}").nullable();

// ---------------------------------------------------------------------------
// Query-string helpers
// ---------------------------------------------------------------------------

/**
 * URLSearchParams → plain object for Zod. Repeated keys become arrays and a
 * trailing `[]` is stripped (`category[]` → `category`).
 */
export function searchParamsToObject(sp: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [rawKey, value] of sp.entries()) {
    const key = rawKey.endsWith("[]") ? rawKey.slice(0, -2) : rawKey;
    const prev = out[key];
    if (prev === undefined) out[key] = value;
    else out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

/** Query number: rejects "" (which `Number()` would turn into 0). */
function queryNumber<T extends z.ZodNumber>(schema: T) {
  return z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), schema);
}

export const queryLatSchema = queryNumber(latSchema);
export const queryLngSchema = queryNumber(lngSchema);

/**
 * Optional query-string array: accepts a string, a comma list, or repeated
 * params; trims, drops empties, de-duplicates. Absent/empty → `undefined`
 * (meaning "no filter").
 */
export function queryArray<T extends z.ZodType>(item: T) {
  return z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const parts = (Array.isArray(v) ? v : [v])
      .flatMap((s) => (typeof s === "string" ? s.split(",") : [s]))
      .map((s) => (typeof s === "string" ? s.trim() : s))
      .filter((s) => s !== "");
    return parts.length === 0 ? undefined : [...new Set(parts)];
  }, z.array(item).min(1).optional());
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

/**
 * Query string: `bbox=minLng,minLat,maxLng,maxLat` (WGS84, same order as
 * MapLibre's `map.getBounds().toArray().flat()`). Parsed into an object.
 * Antimeridian-crossing boxes are not supported (Mumbai demo).
 */
export const bboxSchema = z.object({
  minLng: lngSchema,
  minLat: latSchema,
  maxLng: lngSchema,
  maxLat: latSchema,
});
export type Bbox = z.infer<typeof bboxSchema>;

export const queryBboxSchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const parts = v.split(",").map((s) => (s.trim() === "" ? Number.NaN : Number(s)));
  if (parts.length !== 4) return v;
  const [minLng, minLat, maxLng, maxLat] = parts;
  return { minLng, minLat, maxLng, maxLat };
}, bboxSchema.refine((b) => b.minLng <= b.maxLng && b.minLat <= b.maxLat, "bbox must be minLng,minLat,maxLng,maxLat"));

/** Inverse of `queryBboxSchema`, for clients building the URL. */
export function formatBbox(b: Bbox): string {
  return [b.minLng, b.minLat, b.maxLng, b.maxLat].join(",");
}

// ---------------------------------------------------------------------------
// Shared objects
// ---------------------------------------------------------------------------

export const issueIdParamsSchema = z.object({ id: uuidSchema });
export type IssueIdParams = z.infer<typeof issueIdParamsSchema>;

export const departmentRefSchema = z.object({ id: uuidSchema, name: z.string() });
export type DepartmentRef = z.infer<typeof departmentRefSchema>;

/** Public view of a `resolution_evidence` row (no `uploaded_by`). */
export const resolutionEvidenceSchema = z.object({
  id: uuidSchema,
  image_url: imageUrlSchema,
  note: z.string().nullable(),
  created_at: isoDateTimeSchema,
});
export type ResolutionEvidence = z.infer<typeof resolutionEvidenceSchema>;

/**
 * GET /api/photos/:kind/:id — serves a report photo (`report`, id = report id)
 * or a resolution evidence photo (`evidence`, id = resolution_evidence id)
 * (02 §10.2–10.3, §13).
 *
 * Both buckets are private: object paths are `{uid}/{uuid}.jpg`, so a Storage
 * URL would expose the uploader's uid (06 rule 22). The path is resolved by
 * `photo_object` and the object is downloaded with the service role and
 * streamed back. Public, but the viewer (if signed in) is passed so photos of
 * a REJECTED issue stay visible to authorities and the issue's own reporters
 * only — the same rule as GET /api/issues/:id. Errors use the JSON envelope.
 */
import { StorageApiError } from "@supabase/supabase-js";
import { z } from "zod";
import { STORAGE_BUCKETS } from "@/config/civic";
import { photoParamsSchema } from "@/contracts/primitives";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiRouteError, callRpc, getCaller, parseDbResult, parseParams, withApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Short on purpose: moderation is enforced here, not by Storage, so once an
 * issue is rejected its photos must stop being served within minutes. Browser
 * and CDN copies of a previously public photo expire after at most 5 minutes.
 */
const PUBLIC_CACHE = "public, max-age=300, s-maxage=300";
/** A photo of a REJECTED issue is served only to some viewers: never let a shared cache keep it. */
const VIEWER_ONLY_CACHE = "private, no-store";

const photoObjectSchema = z.object({
  bucket: z.enum([STORAGE_BUCKETS.reportPhotos, STORAGE_BUCKETS.resolutionPhotos]),
  path: z.string().min(1),
  /** False when the issue is REJECTED (visible to this viewer only). */
  public: z.boolean(),
});

const notFound = () => new ApiRouteError("NOT_FOUND", "Photo not found.");

/** Storage answers a missing object with 404 / `NoSuchKey` (older versions: HTTP 400 with statusCode "404"). */
function isMissingObject(error: unknown): boolean {
  return (
    error instanceof StorageApiError &&
    (error.status === 404 || error.statusCode === "404" || error.code === "NoSuchKey" || error.code === "not_found")
  );
}

export const GET = withApi(async (req, ctx: { params: Promise<{ kind: string; id: string }> }) => {
  const { kind, id } = await parseParams(ctx, photoParamsSchema);
  const caller = await getCaller(req);
  const raw = await callRpc("photo_object", { p_kind: kind, p_id: id, p_viewer_id: caller?.user.id ?? null });
  if (raw === null) throw notFound();
  const object = parseDbResult(photoObjectSchema, raw, "photo_object");

  const { data, error } = await getAdminClient().storage.from(object.bucket).download(object.path).asStream();
  if (error) {
    // e.g. seeded rows, whose objects are never uploaded (supabase/seed.sql).
    if (isMissingObject(error)) throw notFound();
    throw error;
  }

  return new Response(data, {
    status: 200,
    headers: {
      // Both buckets only accept image/jpeg (02 §10.2).
      "Content-Type": "image/jpeg",
      "Cache-Control": object.public ? PUBLIC_CACHE : VIEWER_ONLY_CACHE,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

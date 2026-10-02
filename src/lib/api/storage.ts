/**
 * Photo URLs (02 §10.2). Both buckets are private and objects live at
 * `{uid}/{uuid}.jpg`, so a Storage URL would expose the uploader's uid
 * (06 rule 22). Responses instead point at the app's own photo route, which
 * resolves the object server-side (`photo_object`) and streams it back.
 */
import type { PhotoKind } from "@/contracts/primitives";

/**
 * Same-origin URL of a photo: `/api/photos/report/<report id>` or
 * `/api/photos/evidence/<resolution_evidence id>` (served by
 * src/app/api/photos/[kind]/[id]/route.ts).
 */
export function photoUrl(kind: PhotoKind /* "report" | "evidence" */, id: string): string {
  return `/api/photos/${kind}/${encodeURIComponent(id)}`;
}

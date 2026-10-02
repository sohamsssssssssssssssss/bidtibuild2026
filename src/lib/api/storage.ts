import type { StorageBucket } from "@/config/civic";
import { requiredEnv } from "./env";

/** Public Storage URL for an object path (02 §10.2: both buckets are public-read). */
export function publicImageUrl(bucket: StorageBucket, path: string): string {
  const base = requiredEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${bucket}/${encoded}`;
}

/** Replaces a row's `image_path` with `image_url` (null stays null: hidden photo, 02 §10.3). */
export function withImageUrl<T extends { image_path: string | null }>(
  row: T,
  bucket: StorageBucket,
): Omit<T, "image_path"> & { image_url: string | null } {
  const { image_path, ...rest } = row;
  return { ...rest, image_url: image_path === null ? null : publicImageUrl(bucket, image_path) };
}

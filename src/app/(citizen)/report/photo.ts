import { PHOTO_CONFIG, STORAGE_BUCKET_LIMITS } from "@/config/civic";

export async function prepareReportPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > PHOTO_CONFIG.max_original_bytes)
    throw new Error("Choose a photo smaller than 10 MB.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Could not read this photo. Please choose a JPEG or PNG.");
  }

  try {
    const scale = Math.min(
      1,
      PHOTO_CONFIG.max_edge_px / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Photo processing is unavailable in this browser.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const output = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(
        resolve,
        PHOTO_CONFIG.output_mime_type,
        PHOTO_CONFIG.jpeg_quality,
      ),
    );
    if (!output)
      throw new Error("Could not prepare this photo. Please choose another.");
    if (output.size > STORAGE_BUCKET_LIMITS.file_size_limit_bytes)
      throw new Error(
        "This photo is still too large after processing. Please choose another.",
      );
    return output;
  } finally {
    bitmap.close();
  }
}

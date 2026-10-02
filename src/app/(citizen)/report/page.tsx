"use client";
/* eslint-disable @next/next/no-img-element -- Preview uses a local object URL. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  CATEGORIES,
  CATEGORY_META,
  LEVELS,
  LEVEL_META,
  PHOTO_CONFIG,
  STORAGE_BUCKETS,
  TEXT_LIMITS,
  type Category,
  type Level,
} from "@/config/civic";
import { apiEnvelopeSchema } from "@/contracts/envelope";
import {
  createReportBodySchema,
  createReportResponseSchema,
} from "@/contracts/reports";
import { descriptionSchema } from "@/contracts/primitives";
import {
  createSupabaseBrowserClient,
  ensureCitizenSession,
} from "@/lib/supabase/browser";
import { LocationPicker, type Pin } from "./LocationPicker";
import { prepareReportPhoto } from "./photo";

const envelope = apiEnvelopeSchema(createReportResponseSchema);

export default function ReportPage() {
  const router = useRouter();
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Level | "">("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [pin, setPin] = useState<Pin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState("");

  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!photo || !pin) {
      setError("Add a photo and place a pin before submitting.");
      return;
    }
    setBusy(true);
    try {
      const checkedDescription = descriptionSchema.safeParse(description);
      if (!checkedDescription.success)
        throw new Error("Add a description before submitting.");
      setStep("Preparing photo…");
      const upload = await prepareReportPhoto(photo);
      setStep("Signing in…");
      await ensureCitizenSession();
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user)
        throw (
          userError ?? new Error("Citizen session unavailable. Please retry.")
        );
      const imagePath = `${user.id}/${crypto.randomUUID()}${PHOTO_CONFIG.file_extension}`;
      const body = createReportBodySchema.parse({
        category,
        description: checkedDescription.data,
        citizen_severity: severity || null,
        image_path: imagePath,
        ...pin,
      });
      setStep("Uploading photo…");
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKETS.reportPhotos)
        .upload(imagePath, upload, {
          contentType: PHOTO_CONFIG.output_mime_type,
        });
      if (uploadError)
        throw new Error(`Photo upload failed: ${uploadError.message}`);
      setStep("Submitting report…");
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = envelope.parse(await response.json());
      if (!response.ok || result.error)
        throw new Error(result.error?.message ?? "Could not submit report.");
      router.push(
        `/report/success?issue=${encodeURIComponent(result.data.issue_id)}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not submit report. Please retry.",
      );
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <div className="page-wrap report-page">
      <div className="page-heading">
        <p className="eyebrow">Citizen report</p>
        <h1>Report an issue.</h1>
        <p>Add a photo and pin the exact spot so the issue can be found.</p>
      </div>
      <form className="report-form" onSubmit={(event) => void submit(event)}>
        <div className="report-fields">
          <label>
            <span>Category *</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
              required
            >
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_META[value].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Description *</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={TEXT_LIMITS.description.max}
              rows={5}
              placeholder="What happened? Add details that help locate it."
              required
            />
          </label>
          <label>
            <span>Photo *</span>
            <input
              type="file"
              accept={PHOTO_CONFIG.accept}
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setPhoto(selected);
                setPreview(selected ? URL.createObjectURL(selected) : "");
              }}
              required
            />
          </label>
          {preview && (
            <div className="photo-preview">
              <img src={preview} alt="Selected report photo preview" />
            </div>
          )}
          <label>
            Severity (optional)
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as Level | "")
              }
            >
              <option value="">Not sure</option>
              {LEVELS.map((value) => (
                <option key={value} value={value}>
                  {LEVEL_META[value].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="report-location">
          <h2>
            Pin the location <span aria-hidden="true">*</span>
          </h2>
          <LocationPicker pin={pin} onChange={setPin} />
        </div>
        <div className="report-actions">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {busy && <p role="status">{step}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Submitting…" : "Submit report"}
          </button>
          <Link href="/">Back to issue map</Link>
        </div>
      </form>
    </div>
  );
}

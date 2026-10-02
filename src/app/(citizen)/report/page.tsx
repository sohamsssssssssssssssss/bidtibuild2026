"use client";
/* eslint-disable @next/next/no-img-element -- Preview uses a local object URL. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { TESTIDS } from "@/config/testids";
import {
  createReportBodySchema,
  type CreateReportBody,
  type DuplicateCandidate,
  type ReportWriteResult,
} from "@/contracts/reports";
import { descriptionSchema } from "@/contracts/primitives";
import {
  createSupabaseBrowserClient,
  ensureCitizenSession,
} from "@/lib/supabase/browser";
import { DuplicateCandidates } from "@/components/report/DuplicateCandidates";
import {
  FriendlyError,
  NETWORK_MESSAGE,
  createReport,
  fetchDuplicateCandidates,
  successUrl,
  supportIssue,
} from "@/components/report/reportApi";
import "@/components/report/report.css";
import { LocationPicker, type Pin } from "./LocationPicker";
import { prepareReportPhoto } from "./photo";

/** A photo already in storage, reused across choices so it is never uploaded twice. */
type UploadedPhoto = { file: File; path: string; userId: string };

function friendly(cause: unknown, fallback: string): string {
  if (cause instanceof FriendlyError) return cause.message;
  if (cause instanceof TypeError && /fetch|network/i.test(cause.message))
    return NETWORK_MESSAGE;
  if (cause instanceof Error && cause.message && !/^\[|\{/.test(cause.message))
    return cause.message;
  return fallback;
}

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
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(
    null,
  );
  const [pendingBody, setPendingBody] = useState<CreateReportBody | null>(null);
  const uploadedRef = useRef<UploadedPhoto | null>(null);
  const locatingRef = useRef<Promise<Pin | null> | null>(null);
  const navigatingRef = useRef(false);

  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function ensurePhotoUploaded(file: File): Promise<string> {
    setStep("Signing in…");
    await ensureCitizenSession();
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user)
      throw new FriendlyError(
        "We couldn't start your session. Please try again.",
      );
    const cached = uploadedRef.current;
    if (cached && cached.file === file && cached.userId === user.id)
      return cached.path;

    setStep("Preparing photo…");
    const upload = await prepareReportPhoto(file);
    const path = `${user.id.toLowerCase()}/${crypto.randomUUID().toLowerCase()}${PHOTO_CONFIG.file_extension}`;
    setStep("Uploading photo…");
    let uploadError: { message: string } | null = null;
    try {
      ({ error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKETS.reportPhotos)
        .upload(path, upload, {
          contentType: PHOTO_CONFIG.output_mime_type,
          upsert: false,
        }));
    } catch {
      throw new FriendlyError(
        "Photo upload failed — check your connection and try again.",
      );
    }
    if (uploadError)
      throw new FriendlyError(
        "Photo upload failed. Your details are kept — please try again.",
      );
    uploadedRef.current = { file, path, userId: user.id };
    return path;
  }

  function finish(result: ReportWriteResult) {
    navigatingRef.current = true;
    setStep("Opening confirmation…");
    router.push(successUrl(result));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const checkedDescription = descriptionSchema.safeParse(description);
    if (!checkedDescription.success) {
      setError(
        `Add a description (up to ${TEXT_LIMITS.description.max} characters) before submitting.`,
      );
      return;
    }
    if (!photo) {
      setError("Add a photo before submitting.");
      return;
    }
    setBusy(true);
    try {
      let location = pin;
      if (!location && locatingRef.current) {
        setStep("Waiting for your location…");
        location = await locatingRef.current;
      }
      if (!location) {
        setError(
          "Place a pin on the map (or use your location) before submitting.",
        );
        return;
      }
      const imagePath = await ensurePhotoUploaded(photo);
      const parsed = createReportBodySchema.safeParse({
        category,
        description: checkedDescription.data,
        citizen_severity: severity || null,
        image_path: imagePath,
        lat: location.lat,
        lng: location.lng,
      });
      if (!parsed.success) {
        setError(
          "Some of the report details aren't valid. Please check them and try again.",
        );
        return;
      }
      setStep("Checking for similar reports nearby…");
      const found = await fetchDuplicateCandidates({
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        category: parsed.data.category,
      });
      if (found.length > 0) {
        setPendingBody(parsed.data);
        setCandidates(found);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setStep("Submitting report…");
      finish(await createReport(parsed.data));
    } catch (cause) {
      setError(friendly(cause, "Could not submit report. Please try again."));
    } finally {
      if (!navigatingRef.current) {
        setBusy(false);
        setStep("");
      }
    }
  }

  async function choose(
    action: () => Promise<ReportWriteResult>,
    label: string,
  ) {
    if (busy) return;
    setError("");
    setBusy(true);
    setStep(label);
    try {
      finish(await action());
    } catch (cause) {
      setError(friendly(cause, "Could not submit report. Please try again."));
    } finally {
      if (!navigatingRef.current) {
        setBusy(false);
        setStep("");
      }
    }
  }

  function backToEdit() {
    setCandidates(null);
    setPendingBody(null);
    setError("");
  }

  const showingCandidates = candidates !== null && pendingBody !== null;

  return (
    <div className="page-wrap report-page">
      <div className="page-heading">
        <p className="eyebrow">Citizen report</p>
        <h1>Report an issue.</h1>
        <p>Add a photo and pin the exact spot so the issue can be found.</p>
      </div>
      {showingCandidates && error && (
        <p
          className="form-error"
          role="alert"
          data-testid={TESTIDS.reportError}
        >
          {error}
        </p>
      )}
      {showingCandidates && busy && (
        <p className="report-status" role="status">
          {step}
        </p>
      )}
      {showingCandidates && (
        <DuplicateCandidates
          candidates={candidates}
          busy={busy}
          onSameIssue={(candidate) =>
            void choose(
              () => supportIssue(candidate.id, pendingBody),
              "Adding your report to this issue…",
            )
          }
          onCreateNew={() =>
            void choose(
              () => createReport(pendingBody),
              "Creating a new issue…",
            )
          }
          onBack={backToEdit}
        />
      )}
      <form
        className="report-form"
        hidden={showingCandidates}
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div className="report-fields">
          <label>
            <span>Category *</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
              data-testid={TESTIDS.reportCategory}
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
              data-testid={TESTIDS.reportDescription}
              required
            />
          </label>
          <label>
            <span>Photo *</span>
            <input
              type="file"
              accept={PHOTO_CONFIG.accept}
              data-testid={TESTIDS.reportPhotoInput}
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
              data-testid={TESTIDS.reportSeverity}
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
          <LocationPicker
            pin={pin}
            onChange={(next) => {
              locatingRef.current = null;
              setPin(next);
            }}
            onLocating={(pending) => {
              locatingRef.current = pending;
            }}
          />
        </div>
        <div className="report-actions">
          {!showingCandidates && error && (
            <p
              className="form-error"
              role="alert"
              data-testid={TESTIDS.reportError}
            >
              {error}
            </p>
          )}
          {!showingCandidates && busy && <p role="status">{step}</p>}
          <button
            type="submit"
            disabled={busy}
            data-testid={TESTIDS.reportSubmit}
          >
            {busy ? "Submitting…" : "Submit report"}
          </button>
          <Link href="/">Back to issue map</Link>
        </div>
      </form>
    </div>
  );
}

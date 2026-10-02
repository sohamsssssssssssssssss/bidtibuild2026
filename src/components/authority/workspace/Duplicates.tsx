"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CATEGORY_META, TEXT_LIMITS, allowedTransitions } from "@/config/civic";
import type { IssueDetail } from "@/contracts/issues";
import type { DuplicateCandidate } from "@/contracts/reports";
import { CategoryChip, StatusChip } from "@/components/authority/chips";
import { authorityApi } from "@/lib/authority/api";
import { ageLabel } from "@/lib/authority/format";
import { InlineError, Photo, errorText, plural } from "./shared";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; list: DuplicateCandidate[] };

function MergeConfirm({
  issue,
  candidate,
  onCancel,
}: {
  issue: IssueDetail;
  candidate: DuplicateCandidate;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = CATEGORY_META[candidate.category].label.toLowerCase();

  async function merge() {
    setBusy(true);
    setError("");
    try {
      const result = await authorityApi.merge(
        issue.id,
        candidate.id,
        note.trim() || undefined,
      );
      router.push(
        `/authority/issues/${encodeURIComponent(result.target_issue_id)}`,
      );
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  }

  return (
    <div
      className="ws-confirm"
      role="alertdialog"
      aria-label="Confirm merge"
      aria-describedby={`merge-${candidate.id}`}
    >
      <p id={`merge-${candidate.id}`}>
        <strong>This cannot be undone.</strong> This issue&apos;s{" "}
        {plural(issue.report_count, "report")} will move to the {target} issue{" "}
        {Math.round(candidate.distance_m)} m away, and this issue will become
        Merged.
      </p>
      <label className="ws-label">
        Note (optional)
        <textarea
          rows={2}
          maxLength={TEXT_LIMITS.note.max}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="ws-control-row">
        <button
          type="button"
          className="ap-button ap-button-danger"
          disabled={busy}
          onClick={() => void merge()}
        >
          {busy ? "Merging…" : "Confirm merge"}
        </button>
        <button
          type="button"
          className="ap-button ap-button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      <InlineError message={error} />
    </div>
  );
}

export function Duplicates({ issue }: { issue: IssueDetail }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { id, lat, lng, category } = issue;
  const canMerge =
    allowedTransitions(issue.status, { actor: "AUTHORITY", action: "MERGE" })
      .length > 0;

  useEffect(() => {
    let active = true;
    authorityApi
      .duplicateCandidates(lat, lng, category)
      .then((list) => {
        if (active)
          setLoad({ kind: "ready", list: list.filter((c) => c.id !== id) });
      })
      .catch((cause: unknown) => {
        if (active) setLoad({ kind: "error", message: errorText(cause) });
      });
    return () => {
      active = false;
    };
  }, [id, lat, lng, category, attempt]);

  return (
    <section
      className="ap-card ws-section ws-duplicates"
      aria-labelledby="ws-dup-title"
    >
      <p className="ap-kicker">Possible duplicates</p>
      <h2 id="ws-dup-title">Nearby open issues</h2>
      <p className="ap-muted ws-small">
        These nearby open issues may describe the same real-world problem.
        Nothing is merged automatically.
      </p>
      {load.kind === "loading" && (
        <p className="ap-muted" role="status">
          Looking for nearby issues…
        </p>
      )}
      {load.kind === "error" && (
        <p className="ap-error" role="alert">
          {load.message}{" "}
          <button
            type="button"
            className="ap-button ap-button-secondary"
            onClick={() => {
              setLoad({ kind: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {load.kind === "ready" && load.list.length === 0 && (
        <p className="ws-callout">No likely duplicates nearby.</p>
      )}
      {load.kind === "ready" && load.list.length > 0 && (
        <ul className="ws-dup-list">
          {load.list.map((c) => (
            <li key={c.id} className="ws-dup">
              <div className="ws-dup-main">
                <Photo
                  src={c.image_url}
                  alt={`Nearby ${CATEGORY_META[c.category].label}`}
                  className="ws-dup-img"
                />
                <div className="ws-dup-body">
                  <div className="ws-chip-row">
                    <CategoryChip category={c.category} />
                    <StatusChip status={c.status} />
                  </div>
                  <p className="ws-small">
                    <strong>{Math.round(c.distance_m)} m away</strong> ·{" "}
                    {c.match === "EXACT" ? "Same category" : "Related category"}{" "}
                    · {plural(c.report_count, "report")} ·{" "}
                    {ageLabel(c.created_at)} old
                  </p>
                  <div className="ws-control-row">
                    <Link
                      className="ap-button ap-button-secondary ws-link-button"
                      href={`/authority/issues/${c.id}`}
                    >
                      Open
                    </Link>
                    {canMerge && confirming !== c.id && (
                      <button
                        type="button"
                        className="ap-button ap-button-secondary"
                        onClick={() => setConfirming(c.id)}
                      >
                        Merge this issue into it…
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {canMerge && confirming === c.id && (
                <MergeConfirm
                  issue={issue}
                  candidate={c}
                  onCancel={() => setConfirming(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

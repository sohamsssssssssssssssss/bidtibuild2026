"use client";

import { useEffect, useState } from "react";
import type { ZodType } from "zod";
import {
  CATEGORY_META,
  DUPLICATE_CONFIG,
  STATUS_META,
} from "../../../config/civic";
import { apiEnvelopeSchema } from "../../../contracts/envelope";
import {
  issueDetailResponseSchema,
  mergeIssueBodySchema,
  mergeIssueResponseSchema,
  type IssueDetail,
  type MergeIssueResponse,
} from "../../../contracts/issues";
import {
  duplicateCandidatesResponseSchema,
  type DuplicateCandidate,
} from "../../../contracts/reports";
import styles from "./DuplicateCandidates.module.css";

type Lookup =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; issue: IssueDetail; candidates: DuplicateCandidate[] };
type Detail =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; issue: IssueDetail };
type Merge =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "error"; message: string }
  | { state: "done"; result: MergeIssueResponse };

async function request<T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body = await response.json();
  const parsed = apiEnvelopeSchema(schema).safeParse(body);
  if (!parsed.success)
    throw new Error(
      "The server returned an unexpected response. Please retry.",
    );
  if (parsed.data.error) throw new Error(parsed.data.error.message);
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return parsed.data.data;
}

function Photo({ url, alt }: { url: string | null; alt: string }) {
  return url ? (
    // Canonical same-origin /api/photos/... path, validated by the API contract.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.photo} src={url} alt={alt} />
  ) : (
    <div className={styles.photoUnavailable}>Photo unavailable</div>
  );
}

function IssueSide({ issue, title }: { issue: IssueDetail; title: string }) {
  return (
    <section className={styles.issueSide} aria-label={title}>
      <div className={styles.sideHeading}>
        <span className={styles.eyebrow}>{title}</span>
        {issue.is_seed && <span className={styles.demo}>Demo data</span>}
      </div>
      <h3>{CATEGORY_META[issue.category].label}</h3>
      <div className={styles.facts}>
        <span
          className={styles.status}
          style={{ borderColor: STATUS_META[issue.status].color }}
        >
          {STATUS_META[issue.status].label}
        </span>
        <span>
          {issue.report_count} citizen{" "}
          {issue.report_count === 1 ? "report" : "reports"}
        </span>
      </div>
      <p className={styles.location}>
        Location: {issue.lat.toFixed(5)}, {issue.lng.toFixed(5)}
      </p>
      <p className={styles.location}>
        Reported {new Date(issue.created_at).toLocaleDateString()}
      </p>
      <div className={styles.evidence}>
        <Photo
          url={issue.is_seed ? null : (issue.photos[0]?.image_url ?? null)}
          alt={`Report evidence for ${CATEGORY_META[issue.category].label}`}
        />
        <div className={styles.evidenceText}>
          <h4>Citizen evidence</h4>
          {issue.photos.length ? (
            <ul>
              {issue.photos.map((report) => (
                <li key={report.id}>{report.description}</li>
              ))}
            </ul>
          ) : (
            <p>No report descriptions available.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Render from Authority Issue Detail: <DuplicateCandidates issueId={issue.id} />. */
export function DuplicateCandidates(props: {
  issueId: string;
  onMerged?: (result: MergeIssueResponse) => void;
}) {
  return <DuplicateCandidatesForIssue key={props.issueId} {...props} />;
}

function DuplicateCandidatesForIssue({
  issueId,
  onMerged,
}: {
  issueId: string;
  onMerged?: (result: MergeIssueResponse) => void;
}) {
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<DuplicateCandidate | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [merge, setMerge] = useState<Merge>({ state: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const issue = await request(
          `/api/issues/${encodeURIComponent(issueId)}`,
          issueDetailResponseSchema,
          {
            signal: controller.signal,
          },
        );
        const query = new URLSearchParams({
          lat: String(issue.lat),
          lng: String(issue.lng),
          category: issue.category,
        });
        const candidates = await request(
          `/api/duplicate-candidates?${query}`,
          duplicateCandidatesResponseSchema,
          {
            signal: controller.signal,
          },
        );
        if (!controller.signal.aborted) {
          setLookup({
            state: "ready",
            issue,
            candidates: candidates.filter((item) => item.id !== issue.id),
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setLookup({
            state: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not load matches.",
          });
        }
      }
    })();
    return () => controller.abort();
  }, [issueId, reload]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    (async () => {
      try {
        const issue = await request(
          `/api/issues/${encodeURIComponent(selected.id)}`,
          issueDetailResponseSchema,
          {
            signal: controller.signal,
          },
        );
        if (!controller.signal.aborted) setDetail({ state: "ready", issue });
      } catch (error) {
        if (!controller.signal.aborted) {
          setDetail({
            state: "error",
            message:
              error instanceof Error ? error.message : "Could not load issue.",
          });
        }
      }
    })();
    return () => controller.abort();
  }, [selected]);

  function choose(candidate: DuplicateCandidate) {
    setSelected(candidate);
    setDetail({ state: "loading" });
    setConfirm(false);
    setMerge({ state: "idle" });
  }

  async function confirmMerge() {
    if (
      lookup.state !== "ready" ||
      detail?.state !== "ready" ||
      !selected ||
      merge.state === "pending"
    )
      return;
    setMerge({ state: "pending" });
    let result: MergeIssueResponse;
    try {
      const body = mergeIssueBodySchema.parse({ target_issue_id: selected.id });
      result = await request(
        `/api/issues/${encodeURIComponent(lookup.issue.id)}/merge`,
        mergeIssueResponseSchema,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (
        result.source_issue_id !== lookup.issue.id ||
        result.target_issue_id !== selected.id
      ) {
        throw new Error(
          "The merge response did not match the selected issues. Please refresh.",
        );
      }
    } catch (error) {
      setMerge({
        state: "error",
        message: error instanceof Error ? error.message : "Merge failed.",
      });
      return;
    }
    setMerge({ state: "done", result });
    setConfirm(false);
    onMerged?.(result);
  }

  return (
    <section
      className={styles.root}
      aria-label="Possible duplicate issues"
      aria-busy={lookup.state === "loading"}
    >
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Duplicate intelligence</span>
          <h2>Possible duplicate issues</h2>
          <p>
            CivicPulse found existing issues that may describe the same physical
            problem. You decide whether to merge.
          </p>
        </div>
      </header>
      {lookup.state === "loading" && (
        <div className={styles.state} role="status">
          Checking nearby issues…
        </div>
      )}
      {lookup.state === "error" && (
        <div className={styles.state} role="alert">
          <p>Could not check for duplicates: {lookup.message}</p>
          <button
            type="button"
            onClick={() => {
              setLookup({ state: "loading" });
              setReload((value) => value + 1);
            }}
          >
            Retry lookup
          </button>
        </div>
      )}
      {lookup.state === "ready" && lookup.candidates.length === 0 && (
        <div className={styles.state} role="status">
          <strong>No likely duplicate issues found.</strong>
          <p>
            This check found no eligible nearby issues. The authority can
            continue reviewing this issue separately.
          </p>
        </div>
      )}
      {lookup.state === "ready" && lookup.candidates.length > 0 && (
        <>
          <div className={styles.candidates} aria-label="Potential matches">
            {lookup.candidates.map((candidate) => (
              <button
                className={`${styles.candidate} ${selected?.id === candidate.id ? styles.selected : ""}`}
                key={candidate.id}
                type="button"
                aria-pressed={selected?.id === candidate.id}
                onClick={() => choose(candidate)}
              >
                <span className={styles.match}>
                  {candidate.match === "EXACT"
                    ? "Same category"
                    : "Related category"}
                </span>
                <strong>{CATEGORY_META[candidate.category].label}</strong>
                <span>
                  {Math.round(candidate.distance_m)} m away ·{" "}
                  {candidate.report_count} citizen{" "}
                  {candidate.report_count === 1 ? "report" : "reports"}
                </span>
                <span>{STATUS_META[candidate.status].label}</span>
                <span className={styles.review}>Compare issue →</span>
              </button>
            ))}
          </div>
          {selected && detail?.state === "loading" && (
            <div className={styles.state} role="status">
              Loading comparison…
            </div>
          )}
          {selected && detail?.state === "error" && (
            <div className={styles.state} role="alert">
              <p>Could not load the possible match: {detail.message}</p>
              <button type="button" onClick={() => choose({ ...selected })}>
                Retry comparison
              </button>
            </div>
          )}
          {selected && detail?.state === "ready" && (
            <div className={styles.comparison}>
              <div className={styles.comparisonIntro}>
                <div>
                  <span className={styles.eyebrow}>Authority review</span>
                  <h3>Could these be one civic issue?</h3>
                </div>
                <span className={styles.distance}>
                  {Math.round(selected.distance_m)} m apart ·{" "}
                  {selected.match === "EXACT"
                    ? "same category"
                    : "related categories"}
                </span>
              </div>
              <div className={styles.sides}>
                <IssueSide
                  issue={lookup.issue}
                  title="Current issue · source"
                />
                <IssueSide
                  issue={detail.issue}
                  title="Possible existing issue · survives"
                />
              </div>
              {merge.state === "done" ? (
                <div className={styles.result} role="status">
                  <strong>Issues merged.</strong>{" "}
                  {merge.result.moved_report_ids.length} citizen{" "}
                  {merge.result.moved_report_ids.length === 1
                    ? "report now belongs"
                    : "reports now belong"}{" "}
                  to the surviving issue.
                </div>
              ) : (
                <div className={styles.actions}>
                  <button
                    className={styles.secondary}
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setDetail(null);
                      setConfirm(false);
                      setMerge({ state: "idle" });
                    }}
                  >
                    Keep separate
                  </button>
                  <button
                    className={styles.primary}
                    type="button"
                    disabled={
                      !(
                        DUPLICATE_CONFIG.candidate_statuses as readonly string[]
                      ).includes(lookup.issue.status)
                    }
                    onClick={() => setConfirm(true)}
                  >
                    Review merge
                  </button>
                </div>
              )}
              {confirm && merge.state !== "done" && (
                <div
                  className={styles.confirm}
                  role="group"
                  aria-label="Confirm issue merge"
                >
                  <h4>Merge the current issue into this existing issue?</h4>
                  <p>
                    All citizen reports, including their photos, move to the
                    surviving issue. The current issue is marked merged; both
                    issue histories record the action. The surviving issue keeps
                    its own location, category, status, priority and department.
                    There is no undo action.
                  </p>
                  <p>
                    Source: <code>{lookup.issue.id}</code>
                    <br />
                    Survivor: <code>{detail.issue.id}</code>
                  </p>
                  {merge.state === "error" && (
                    <p className={styles.error} role="alert">
                      Merge failed: {merge.message}
                    </p>
                  )}
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      type="button"
                      disabled={merge.state === "pending"}
                      onClick={() => {
                        setConfirm(false);
                        setMerge({ state: "idle" });
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.danger}
                      type="button"
                      disabled={merge.state === "pending"}
                      onClick={confirmMerge}
                    >
                      {merge.state === "pending" ? "Merging…" : "Confirm merge"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

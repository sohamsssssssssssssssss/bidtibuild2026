"use client";
/* eslint-disable @next/next/no-img-element -- Photos use the same-origin API photo route. */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CATEGORY_META, STATUS_META } from "@/config/civic";
import { apiEnvelopeSchema } from "@/contracts/envelope";
import {
  issueDetailResponseSchema,
  type IssueDetail,
} from "@/contracts/issues";
import { uuidSchema } from "@/contracts/primitives";

const envelope = apiEnvelopeSchema(issueDetailResponseSchema);

export default function IssuePage() {
  const { id } = useParams<{ id: string }>();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const validId = uuidSchema.safeParse(id).success;

  useEffect(() => {
    if (!validId) return;
    let active = true;
    void fetch(`/api/issues/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => {
        const parsed = envelope.parse(await response.json());
        if (!response.ok || parsed.error)
          throw new Error(parsed.error?.message ?? "Issue unavailable.");
        if (active) setIssue(parsed.data);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Issue unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [id, validId, attempt]);

  return (
    <div className="page-wrap issue-detail-page">
      <Link href="/">← Issue map</Link>
      {!validId ? (
        <section className="state-panel" role="alert">
          Invalid issue link.
        </section>
      ) : error ? (
        <section className="state-panel" role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </section>
      ) : !issue ? (
        <section className="state-panel" role="status">
          Loading issue…
        </section>
      ) : (
        <>
          <div className="page-heading">
            <p className="eyebrow">Issue detail</p>
            <h1>{CATEGORY_META[issue.category].label}</h1>
            <p>
              <span
                className="status-pill"
                style={{ borderColor: STATUS_META[issue.status].color }}
              >
                {STATUS_META[issue.status].label}
              </span>{" "}
              {issue.is_seed && <span className="demo-tag">Demo data</span>}
            </p>
          </div>
          <div className="issue-detail-grid">
            <section className="state-panel">
              <h2>Reports</h2>
              <p>
                {issue.report_count}{" "}
                {issue.report_count === 1 ? "report" : "reports"} ·{" "}
                {issue.lat.toFixed(5)}, {issue.lng.toFixed(5)}
              </p>
              {issue.photos.map((photo) => (
                <article className="detail-photo" key={photo.id}>
                  {!issue.is_seed && photo.image_url ? (
                    <img
                      src={photo.image_url}
                      alt={`Reported ${CATEGORY_META[photo.category].label}`}
                    />
                  ) : (
                    <p className="photo-fallback">Photo unavailable</p>
                  )}
                  <p>{photo.description}</p>
                  <small>{new Date(photo.created_at).toLocaleString()}</small>
                </article>
              ))}
              {issue.photos.length === 0 && <p>Photos are unavailable.</p>}
            </section>
            <div className="detail-side">
              <section className="state-panel">
                <h2>Status timeline</h2>
                {issue.timeline.length ? (
                  <ol className="timeline">
                    {issue.timeline.map((event) => (
                      <li key={event.id}>
                        <strong>
                          {event.to_status
                            ? STATUS_META[event.to_status].label
                            : event.event_type
                                .replaceAll("_", " ")
                                .toLowerCase()}
                        </strong>
                        <small>
                          {new Date(event.created_at).toLocaleString()}
                        </small>
                        {event.note && <p>{event.note}</p>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No updates yet.</p>
                )}
              </section>
              {issue.resolution_evidence.length > 0 && (
                <section className="state-panel">
                  <h2>Resolution evidence</h2>
                  {issue.resolution_evidence.map((evidence) => (
                    <article className="detail-photo" key={evidence.id}>
                      {evidence.image_url && (
                        <img
                          src={evidence.image_url}
                          alt="Evidence of issue resolution"
                        />
                      )}
                      {evidence.note && <p>{evidence.note}</p>}
                    </article>
                  ))}
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

"use client";
/* eslint-disable @next/next/no-img-element -- Photos use the same-origin API photo route. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiEnvelopeSchema } from "@/contracts/envelope";
import { myReportsResponseSchema, type MyReport } from "@/contracts/reports";
import { CATEGORY_META, STATUS_META } from "@/config/civic";
import { ensureCitizenSession } from "@/lib/supabase/browser";

const envelope = apiEnvelopeSchema(myReportsResponseSchema);

export default function MyReportsPage() {
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      await ensureCitizenSession();
      const response = await fetch("/api/my-reports", { cache: "no-store" });
      const parsed = envelope.parse(await response.json());
      if (!response.ok || parsed.error)
        throw new Error(
          parsed.error?.message ?? "Could not load your reports.",
        );
      if (active) setReports(parsed.data);
    })().catch((cause: unknown) => {
      if (active)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load your reports.",
        );
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <div className="page-wrap reports-page">
      <div className="page-heading">
        <p className="eyebrow">Citizen record</p>
        <h1>My Reports</h1>
        <p>Reports linked to this browser&apos;s anonymous session.</p>
      </div>
      {error ? (
        <section className="state-panel" role="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              setReports(null);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        </section>
      ) : reports === null ? (
        <section className="state-panel" role="status">
          Loading your reports…
        </section>
      ) : reports.length === 0 ? (
        <section className="state-panel" role="status">
          <h2>No reports yet</h2>
          <p>Issues you report will appear here.</p>
          <Link href="/report">Report an issue</Link>
        </section>
      ) : (
        <div className="report-list">
          {reports.map((report) => (
            <article className="report-card" key={report.id}>
              <div className="report-photo">
                {report.image_url ? (
                  <img
                    src={report.image_url}
                    alt={`Report of ${CATEGORY_META[report.category].label}`}
                  />
                ) : (
                  <span>Photo unavailable</span>
                )}
              </div>
              <div>
                <p className="eyebrow">
                  {new Date(report.created_at).toLocaleDateString()}
                </p>
                <h2>{CATEGORY_META[report.category].label}</h2>
                <p>{report.description}</p>
                <span
                  className="status-pill"
                  style={{
                    borderColor: STATUS_META[report.issue.status].color,
                  }}
                >
                  {STATUS_META[report.issue.status].label}
                </span>
                <p>
                  <Link href={`/issues/${report.issue.id}`}>
                    View issue detail
                  </Link>
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

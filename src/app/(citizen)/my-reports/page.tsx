"use client";

import { useRouter } from "next/navigation";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiEnvelopeSchema } from "@/contracts/envelope";
import { myReportsResponseSchema, type MyReport } from "@/contracts/reports";
import { CATEGORY_META, STATUS_META } from "@/config/civic";
import {
  createSupabaseBrowserClient,
  ensureCitizenSession,
} from "@/lib/supabase/browser";
import { TESTIDS } from "@/config/testids";
import { Photo } from "@/components/Photo";

const envelope = apiEnvelopeSchema(myReportsResponseSchema);

export default function MyReportsPage() {
  const router = useRouter();
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
      if (active) {
        setReports(parsed.data);
        setError("");
      }
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

  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const issueIds = [...new Set(reports?.map((report) => report.issue.id) ?? [])]
    .sort()
    .join(",");
  useEffect(() => {
    if (!issueIds) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel("citizen-report-updates");
    for (const id of issueIds.split(","))
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "issues",
          filter: `id=eq.${id}`,
        },
        () => setAttempt((value) => value + 1),
      );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [issueIds]);

  return (
    <div className="page-wrap reports-page">
      <div className="page-heading">
        <p className="eyebrow">Citizen record</p>
        <h1>My Reports</h1>
        <p>Reports linked to this browser&apos;s anonymous session.</p>
        <button
          type="button"
          className="text-button"
          data-testid={TESTIDS.myReportsRefresh}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh reports
        </button>
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
            <article
              className="report-card"
              key={report.id}
              data-testid={TESTIDS.myReport}
              data-issue-id={report.issue.id}
              onClick={(event) => {
                // The whole card opens the issue; inner links/controls keep their own action.
                if ((event.target as HTMLElement).closest("a, button, summary"))
                  return;
                router.push(`/issues/${report.issue.id}`);
              }}
            >
              <div className="report-photo">
                <Photo
                  src={report.image_url}
                  alt={`Report of ${CATEGORY_META[report.category].label}`}
                />
              </div>
              <div>
                <p className="eyebrow">
                  {new Date(report.created_at).toLocaleDateString()}
                </p>
                <h2>{CATEGORY_META[report.category].label}</h2>
                <p>{report.description}</p>
                <span
                  className="status-pill"
                  data-testid={TESTIDS.issueStatus}
                  style={{
                    borderColor: STATUS_META[report.issue.status].color,
                  }}
                >
                  {STATUS_META[report.issue.status].label}
                  <span className="visually-hidden" aria-hidden="true">
                    {report.issue.status}
                  </span>
                </span>
                <p>
                  <Link href={`/issues/${report.issue.id}`}>
                    View issue detail
                  </Link>
                </p>
                {report.issue.latest_resolution_evidence && (
                  <details data-testid={TESTIDS.resolutionEvidence}>
                    <summary>Resolution evidence</summary>
                    <Photo
                      src={report.issue.latest_resolution_evidence.image_url}
                      alt="Completed work evidence"
                    />
                    {report.issue.latest_resolution_evidence.note && (
                      <p>{report.issue.latest_resolution_evidence.note}</p>
                    )}
                  </details>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

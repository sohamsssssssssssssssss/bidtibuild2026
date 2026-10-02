"use client";

import { useEffect, useState } from "react";
import { CATEGORY_META, STATUS_META } from "@/config/civic";
import { apiEnvelopeSchema } from "@/contracts/envelope";
import {
  myReportsResponseSchema,
  type MyReportsResponse,
} from "@/contracts/reports";
import { ensureCitizenSession } from "@/lib/supabase/browser";

export default function MyReportsPage() {
  const [reports, setReports] = useState<MyReportsResponse>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    ensureCitizenSession()
      .then(async (user) => {
        if (!user) throw new Error("Supabase is not configured");
        const response = await fetch("/api/my-reports", {
          signal: controller.signal,
          cache: "no-store",
        });
        const parsed = apiEnvelopeSchema(myReportsResponseSchema).safeParse(
          await response.json(),
        );
        if (!response.ok || !parsed.success || parsed.data.error)
          throw new Error("My Reports unavailable");
        if (!active) return;
        setReports(parsed.data.data);
        setState(parsed.data.data.length ? "ready" : "empty");
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setState("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [retry]);

  return (
    <div className="page-body">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CITIZEN REPORTS</p>
          <h1>My Reports</h1>
          <p>Reports tied to this browser&apos;s citizen session.</p>
        </div>
      </div>
      {state === "loading" && (
        <p className="read-state" role="status">
          Loading your reports…
        </p>
      )}
      {state === "empty" && (
        <p className="read-state">No reports in this citizen session yet.</p>
      )}
      {state === "error" && (
        <div className="read-state" role="alert">
          Could not load My Reports.{" "}
          <button
            type="button"
            onClick={() => {
              setState("loading");
              setRetry((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {state === "ready" && (
        <ul className="report-list">
          {reports.map((report) => (
            <li key={report.id} className="report-card">
              <div>
                <strong>{CATEGORY_META[report.category].label}</strong>
                <span
                  className="report-status"
                  style={{ color: STATUS_META[report.issue.status].color }}
                >
                  {STATUS_META[report.issue.status].label}
                </span>
              </div>
              <p>{report.description}</p>
              <p className="report-meta">
                {new Date(report.created_at).toLocaleDateString()} ·{" "}
                {report.issue.report_count}{" "}
                {report.issue.report_count === 1 ? "report" : "reports"} on this
                issue
              </p>
              {report.image_url ? (
                <a
                  href={report.image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View photo
                </a>
              ) : (
                <span className="photo-fallback">Photo unavailable</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

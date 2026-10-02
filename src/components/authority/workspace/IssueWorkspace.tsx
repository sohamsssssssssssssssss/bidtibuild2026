"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { IssueDetail } from "@/contracts/issues";
import {
  CategoryChip,
  DemoTag,
  StatusChip,
} from "@/components/authority/chips";
import { AuthorityApiError, authorityApi } from "@/lib/authority/api";
import { ageLabel, coords, dateTime, shortId } from "@/lib/authority/format";
import { CitizenSignal } from "./CitizenSignal";
import { DecisionPanel, type DepartmentsState } from "./DecisionPanel";
import { DuplicateCandidates } from "@/components/authority/duplicates/DuplicateCandidates";
import { Recommendation, type RowState } from "./Recommendation";
import { errorText, isAuthError } from "./shared";

type Loaded = {
  issue: IssueDetail;
  row: RowState;
  departments: DepartmentsState;
};
type PageState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "auth"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Loaded };

async function loadAll(id: string): Promise<Loaded> {
  const [issue, queue, departments] = await Promise.allSettled([
    authorityApi.issue(id),
    authorityApi.queue(),
    authorityApi.departments(),
  ]);
  if (issue.status === "rejected") throw issue.reason;
  let row: RowState;
  if (queue.status === "rejected")
    row = { kind: "error", message: errorText(queue.reason) };
  else {
    const found = queue.value.find((r) => r.id === id);
    row = found ? { kind: "ready", row: found } : { kind: "missing" };
  }
  return {
    issue: issue.value,
    row,
    departments:
      departments.status === "fulfilled"
        ? { kind: "ready", list: departments.value }
        : { kind: "error", message: errorText(departments.reason) },
  };
}

function failure(cause: unknown): PageState {
  if (
    cause instanceof AuthorityApiError &&
    (cause.status === 404 || cause.code === "NOT_FOUND")
  )
    return { kind: "not-found" };
  if (isAuthError(cause)) return { kind: "auth", message: errorText(cause) };
  return {
    kind: "error",
    message: errorText(cause, "Could not load this issue."),
  };
}

export function IssueWorkspace({ id }: { id: string }) {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [reloadError, setReloadError] = useState("");

  useEffect(() => {
    let active = true;
    loadAll(id)
      .then((data) => {
        if (active) setState({ kind: "ready", data });
      })
      .catch((cause: unknown) => {
        if (active) setState(failure(cause));
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  /** Re-reads the issue and its queue row after a successful write. Never throws. */
  const reload = useCallback(async () => {
    try {
      const data = await loadAll(id);
      setReloadError("");
      setState({ kind: "ready", data });
    } catch (cause) {
      const next = failure(cause);
      if (next.kind === "auth" || next.kind === "not-found") setState(next);
      else
        setReloadError(
          `Saved, but the page could not refresh: ${errorText(cause)}`,
        );
    }
  }, [id]);

  const retry = () => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

  return (
    <div className="page-wrap ws-page">
      <Link className="ws-back" href="/authority">
        ← Triage queue
      </Link>
      {state.kind === "loading" && (
        <section className="state-panel" role="status">
          Loading issue…
        </section>
      )}
      {state.kind === "not-found" && (
        <section className="state-panel" role="alert">
          <h2>Issue not found</h2>
          <p>It may have been removed, or the link is wrong.</p>
        </section>
      )}
      {state.kind === "auth" && (
        <section className="state-panel" role="alert">
          <h2>Authority access required</h2>
          <p>{state.message}</p>
          <Link href="/authority/login">Sign in as authority staff</Link>
        </section>
      )}
      {state.kind === "error" && (
        <section className="state-panel" role="alert">
          {state.message}{" "}
          <button type="button" onClick={retry}>
            Retry
          </button>
        </section>
      )}
      {state.kind === "ready" && (
        <Workspace
          data={state.data}
          reload={reload}
          reloadError={reloadError}
          onRetry={() => void reload()}
        />
      )}
    </div>
  );
}

function Workspace({
  data,
  reload,
  reloadError,
  onRetry,
}: {
  data: Loaded;
  reload: () => Promise<void>;
  reloadError: string;
  onRetry: () => void;
}) {
  const { issue, row, departments } = data;
  const queueRow = row.kind === "ready" ? row.row : null;
  return (
    <>
      <header className="ws-header">
        <p className="ap-kicker">Issue workspace</p>
        <div className="ws-title-row">
          <h1 className="ws-title">
            <CategoryChip category={issue.category} />
          </h1>
          <StatusChip status={issue.status} testId />
          {issue.is_seed && <DemoTag />}
        </div>
        <p className="ap-muted ws-meta">
          Reported {dateTime(issue.created_at)} ({ageLabel(issue.created_at)}{" "}
          ago) · Updated {dateTime(issue.updated_at)} ·{" "}
          {coords(issue.lat, issue.lng)} ·{" "}
          <span className="ws-id">#{shortId(issue.id)}</span>
        </p>
        {issue.merged_into_issue_id && (
          <p className="ws-callout">
            This issue was merged into another issue.{" "}
            <Link href={`/authority/issues/${issue.merged_into_issue_id}`}>
              Open the issue it was merged into →
            </Link>
          </p>
        )}
        {reloadError && (
          <p className="ap-error" role="alert">
            {reloadError}{" "}
            <button
              type="button"
              className="ap-button ap-button-secondary"
              onClick={onRetry}
            >
              Retry
            </button>
          </p>
        )}
      </header>

      <div className="ws-grid">
        <div className="ws-col">
          <CitizenSignal issue={issue} row={queueRow} />
        </div>
        <div className="ws-col">
          <Recommendation issue={issue} state={row} />
        </div>
        <div className="ws-col">
          <DecisionPanel
            issue={issue}
            row={queueRow}
            departments={departments}
            reload={reload}
          />
        </div>
      </div>

      <DuplicateCandidates issueId={issue.id} onMerged={() => void reload()} />
    </>
  );
}

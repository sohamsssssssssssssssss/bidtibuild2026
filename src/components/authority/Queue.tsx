"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import "@/app/authority/queue.css";
import {
  CATEGORIES,
  CATEGORY_META,
  STATUS_META,
  openStatuses,
  type Category,
  type OpenStatus,
} from "@/config/civic";
import { TESTIDS } from "@/config/testids";
import {
  DEPARTMENT_FILTER_UNASSIGNED,
  type AuthorityQueueQuery,
  type AuthorityQueueRow,
} from "@/contracts/authority";
import type { Department } from "@/contracts/departments";
import { useAuthorityUser } from "@/components/auth/AuthoritySession";
import { CityMap } from "@/components/map/CityMap";
import {
  CategoryChip,
  DemoTag,
  LevelChip,
  StatusChip,
} from "@/components/authority/chips";
import { AuthorityApiError, authorityApi } from "@/lib/authority/api";
import { ageLabel, coords, shortId, slaState } from "@/lib/authority/format";

const STATUS_OPTIONS = openStatuses();
const ALL_DEPARTMENTS = "";

type LoadError = { message: string; auth: boolean };

function toLoadError(cause: unknown): LoadError {
  if (cause instanceof AuthorityApiError)
    return {
      message: cause.message,
      auth: cause.code === "UNAUTHENTICATED" || cause.code === "FORBIDDEN",
    };
  return {
    message: cause instanceof Error ? cause.message : "Queue unavailable.",
    auth: false,
  };
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function needsDecision(row: AuthorityQueueRow): boolean {
  return (
    (row.label === "HIGH" || row.label === "CRITICAL") && !row.final_priority
  );
}

export function Queue() {
  const { email } = useAuthorityUser();
  const [statuses, setStatuses] = useState<OpenStatus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [department, setDepartment] = useState<string>(ALL_DEPARTMENTS);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rows, setRows] = useState<AuthorityQueueRow[] | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadedAt, setLoadedAt] = useState(0);

  const filtered =
    statuses.length > 0 ||
    categories.length > 0 ||
    department !== ALL_DEPARTMENTS;

  useEffect(() => {
    let active = true;
    void authorityApi
      .departments()
      .then((list) => {
        if (active) setDepartments(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const query: AuthorityQueueQuery = {
      status: statuses.length ? statuses : undefined,
      category: categories.length ? categories : undefined,
      department_id: department || undefined,
    };
    void authorityApi
      .queue(query)
      .then((data) => {
        if (!active) return;
        setRows(data);
        setError(null);
        setLoadedAt(Date.now());
      })
      .catch((cause: unknown) => {
        if (active) setError(toLoadError(cause));
      });
    return () => {
      active = false;
    };
  }, [statuses, categories, department, attempt]);

  const reload = () => {
    setRows(null);
    setError(null);
    setAttempt((value) => value + 1);
  };

  const applyFilter = (apply: () => void) => {
    setRows(null);
    setError(null);
    apply();
  };

  const clearFilters = () =>
    applyFilter(() => {
      setStatuses([]);
      setCategories([]);
      setDepartment(ALL_DEPARTMENTS);
    });

  const summary = useMemo(() => {
    if (!rows) return null;
    return {
      open: rows.length,
      unassigned: rows.filter((row) => !row.department).length,
      urgent: rows.filter(
        (row) => row.label === "HIGH" || row.label === "CRITICAL",
      ).length,
      overdue: rows.filter(
        (row) =>
          row.sla_due_at !== null &&
          new Date(row.sla_due_at).getTime() < loadedAt,
      ).length,
    };
  }, [rows, loadedAt]);

  return (
    <div className="aq">
      <header className="aq-header">
        <div className="page-heading aq-heading">
          <p className="eyebrow">Authority workspace</p>
          <h1>Triage queue</h1>
          <p>
            Citizen reports are grouped into issues. CivicPulse recommends where
            to look first; you make the decision.
          </p>
        </div>
        <div className="aq-account">
          <span className="aq-email" title={email}>
            {email || "Signed in"}
          </span>
          <div className="aq-account-actions">
            <button
              type="button"
              className="ap-button ap-button-secondary"
              onClick={reload}
              disabled={rows === null && !error}
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="aq-summary" aria-label="Queue summary">
        <SummaryStat
          label={filtered ? "Issues shown" : "Open issues"}
          value={summary?.open}
        />
        <SummaryStat
          label="Unassigned"
          value={summary?.unassigned}
          tone={summary?.unassigned ? "warn" : undefined}
        />
        <SummaryStat
          label="Recommended high or critical"
          value={summary?.urgent}
        />
        <SummaryStat
          label="SLA overdue"
          value={summary?.overdue}
          tone={summary?.overdue ? "alert" : undefined}
        />
      </section>

      <section className="aq-map" aria-label="City issue map">
        <h2>City context</h2>
        <CityMap detailBasePath="/authority/issues" />
      </section>

      <section className="aq-filters ap-card" aria-label="Filters">
        <fieldset className="aq-filter-group">
          <legend>Status</legend>
          <div className="aq-chips">
            {STATUS_OPTIONS.map((status) => (
              <FilterChip
                key={status}
                label={STATUS_META[status].label}
                pressed={statuses.includes(status)}
                onToggle={() =>
                  applyFilter(() => setStatuses((list) => toggle(list, status)))
                }
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="aq-filter-group aq-filter-wide">
          <legend>Category</legend>
          <div className="aq-chips">
            {CATEGORIES.map((category) => (
              <FilterChip
                key={category}
                label={CATEGORY_META[category].label}
                pressed={categories.includes(category)}
                onToggle={() =>
                  applyFilter(() =>
                    setCategories((list) => toggle(list, category)),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
        <div className="aq-filter-group">
          <label className="aq-select-label" htmlFor="aq-department">
            Department
          </label>
          <select
            id="aq-department"
            className="aq-select"
            value={department}
            onChange={(event) => {
              const value = event.target.value;
              applyFilter(() => setDepartment(value));
            }}
          >
            <option value={ALL_DEPARTMENTS}>All departments</option>
            <option value={DEPARTMENT_FILTER_UNASSIGNED}>Unassigned</option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="aq-filter-clear">
          <button
            type="button"
            className="aq-link-button"
            onClick={clearFilters}
            disabled={!filtered}
          >
            Clear filters
          </button>
        </div>
      </section>

      <section
        className="aq-queue"
        aria-label="Issue queue"
        data-testid={TESTIDS.queue}
      >
        {error ? (
          <section className="state-panel" role="alert">
            {error.auth ? (
              <>
                Your session has expired or lacks authority access. Please{" "}
                <Link href="/authority/login">sign in again</Link>.
              </>
            ) : (
              <>
                <span className="ap-error">{error.message}</span>
                <button type="button" onClick={reload}>
                  Retry
                </button>
              </>
            )}
          </section>
        ) : rows === null ? (
          <section className="state-panel" role="status">
            Loading queue…
          </section>
        ) : rows.length === 0 ? (
          <section className="state-panel aq-empty" role="status">
            {filtered ? (
              <>
                <h2>No issues match these filters</h2>
                <p>Try a wider filter to see more of the queue.</p>
                <button
                  type="button"
                  className="ap-button ap-button-secondary"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <h2>No open issues</h2>
                <p>New citizen reports will appear here once submitted.</p>
              </>
            )}
          </section>
        ) : (
          <QueueList rows={rows} now={loadedAt} />
        )}
      </section>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: "warn" | "alert";
}) {
  return (
    <div className={`aq-stat${tone ? ` aq-stat-${tone}` : ""}`}>
      <span className="aq-stat-value">{value ?? "–"}</span>
      <span className="aq-stat-label">{label}</span>
    </div>
  );
}

function FilterChip({
  label,
  pressed,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="aq-filter-chip"
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

function QueueList({ rows, now }: { rows: AuthorityQueueRow[]; now: number }) {
  const fallback = rows.every((row) => row.score === null);
  return (
    <>
      {fallback && (
        <p className="aq-note ap-muted">
          Recommended priority is unavailable; issues are ordered by decision
          and age.
        </p>
      )}
      <div className="aq-table">
        <div className="aq-row aq-row-head" aria-hidden="true">
          <span>#</span>
          <span>Issue</span>
          <span>Status</span>
          <span>Citizen signal</span>
          <span>Recommended</span>
          <span>Decision</span>
          <span>Department</span>
          <span>Age · SLA</span>
        </div>
        <ol className="aq-list">
          {rows.map((row, index) => (
            <li key={row.id}>
              <QueueRow row={row} rank={index + 1} now={now} />
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

function QueueRow({
  row,
  rank,
  now,
}: {
  row: AuthorityQueueRow;
  rank: number;
  now: number;
}) {
  const sla = slaState(row.sla_due_at, now);
  const decide = needsDecision(row);
  return (
    <Link
      href={`/authority/issues/${row.id}`}
      className={`aq-row${decide ? " aq-row-decide" : ""}`}
      data-testid={TESTIDS.queueRow}
      data-issue-id={row.id}
    >
      <span className="aq-rank">{rank}</span>

      <span className="aq-cell aq-issue">
        <CategoryChip category={row.category} />
        <span className="aq-sub">
          {coords(row.lat, row.lng)}
          <span className="aq-id">#{shortId(row.id)}</span>
        </span>
        {row.is_seed && (
          <span>
            <DemoTag />
          </span>
        )}
      </span>

      <span className="aq-cell">
        <span className="aq-cell-label">Status</span>
        <StatusChip status={row.status} />
      </span>

      <span className="aq-cell">
        <span className="aq-cell-label">Citizen signal</span>
        <span className="aq-signal">
          {row.report_count} {row.report_count === 1 ? "report" : "reports"} ·{" "}
          {row.distinct_reporter_count}{" "}
          {row.distinct_reporter_count === 1 ? "person" : "people"}
        </span>
        {row.severity_source === "CITIZEN" ? (
          <span className="aq-inline">
            <LevelChip level={row.effective_severity} kind="citizen" />
            <span className="aq-sub">citizen severity</span>
          </span>
        ) : row.severity_source === "AUTHORITY" ? (
          <span className="aq-sub">authority severity</span>
        ) : (
          <span className="aq-sub">no severity given</span>
        )}
      </span>

      <span className="aq-cell">
        <span className="aq-cell-label">Recommended</span>
        {row.label ? (
          <span className="aq-inline">
            <LevelChip
              level={row.label}
              kind="recommended"
              testId={TESTIDS.recommendedLabel}
            />
            {row.score !== null && (
              <span className="aq-sub">score {row.score.toFixed(1)}</span>
            )}
          </span>
        ) : (
          <span className="aq-inline">
            <LevelChip level={null} kind="recommended" />
            <span className="aq-sub">unavailable</span>
          </span>
        )}
        {decide && <span className="aq-decide-tag">Needs decision</span>}
      </span>

      <span className="aq-cell">
        <span className="aq-cell-label">Decision</span>
        <LevelChip level={row.final_priority} kind="authority" />
      </span>

      <span className="aq-cell">
        <span className="aq-cell-label">Department</span>
        {row.department ? (
          <span className="aq-dept">{row.department.name}</span>
        ) : (
          <span className="aq-unassigned">Unassigned</span>
        )}
      </span>

      <span className="aq-cell">
        <span className="aq-cell-label">Age · SLA</span>
        <span>{ageLabel(row.created_at, now)} old</span>
        {sla ? (
          <span className={sla.overdue ? "aq-sla-overdue" : "aq-sub"}>
            {sla.label}
          </span>
        ) : (
          <span className="aq-sub">No SLA yet</span>
        )}
      </span>
    </Link>
  );
}

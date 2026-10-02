"use client";

import {
  CATEGORY_META,
  LEVEL_META,
  PRIORITY_CONFIG,
  type SeveritySource,
} from "@/config/civic";
import { TESTIDS } from "@/config/testids";
import type { AuthorityQueueRow, PriorityFactors } from "@/contracts/authority";
import type { IssueDetail } from "@/contracts/issues";
import { LevelChip } from "@/components/authority/chips";
import { ageLabel } from "@/lib/authority/format";
import { plural } from "./shared";

export type RowState =
  | { kind: "ready"; row: AuthorityQueueRow }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const FACTOR_NAMES: Record<keyof PriorityFactors, string> = {
  severity: "Severity",
  support: "Citizen support",
  age: "Age",
  location_risk: "Location risk",
  recurrence: "Recurrence",
};

const SOURCE_TEXT: Record<SeveritySource, string> = {
  AUTHORITY: "set by the authority",
  CITIZEN: "as reported by citizens",
  DEFAULT: "default — no severity given yet",
};

function helper(
  key: keyof PriorityFactors,
  row: AuthorityQueueRow,
  issue: IssueDetail,
): string {
  switch (key) {
    case "severity":
      return `${LEVEL_META[row.effective_severity].label} severity, ${SOURCE_TEXT[row.severity_source]}.`;
    case "support":
      return `From ${plural(row.distinct_reporter_count, "distinct reporter")}.`;
    case "age":
      return `Open for ${ageLabel(row.created_at)}; reaches 100 after ${PRIORITY_CONFIG.age_full_hours / 24} days.`;
    case "location_risk":
      return `Risk of the mapped zone at this spot (${PRIORITY_CONFIG.default_location_risk} outside any zone).`;
    case "recurrence":
      return row.recurrence_count === null
        ? "Recurrence data unavailable."
        : `${plural(row.recurrence_count, `resolved ${CATEGORY_META[issue.category].label.toLowerCase()} issue`)} nearby in the last ${PRIORITY_CONFIG.recurrence_window_days} days.`;
  }
}

export function Recommendation({
  issue,
  state,
}: {
  issue: IssueDetail;
  state: RowState;
}) {
  const row = state.kind === "ready" ? state.row : null;
  const factors = row?.factors ?? null;
  return (
    <section
      className="ap-card ws-section ws-system"
      aria-labelledby="ws-system-title"
      data-testid={TESTIDS.priorityBreakdown}
    >
      <p className="ap-kicker">System signal</p>
      <h2 id="ws-system-title">CivicPulse recommendation</h2>
      <p className="ap-muted ws-small">
        Recommendation only — the authority sets the operational priority.
      </p>

      {state.kind === "missing" && (
        <p className="ws-callout">
          A recommended priority is available only for open issues. This issue
          is no longer in the triage queue.
        </p>
      )}
      {state.kind === "error" && (
        <p className="ap-error ws-callout" role="alert">
          Recommendation unavailable: {state.message}
        </p>
      )}
      {row && (!factors || row.score === null || !row.label) && (
        <p className="ws-callout">
          Recommended priority is not computed for this issue right now.
        </p>
      )}

      {row && factors && row.score !== null && row.label && (
        <>
          <div className="ws-score">
            <LevelChip level={row.label} kind="recommended" />
            <span className="ws-score-value">
              <strong>{row.score.toFixed(1)}</strong>
              <span className="ap-muted"> / 100</span>
            </span>
          </div>
          <ul className="ws-factors">
            {(Object.keys(FACTOR_NAMES) as (keyof PriorityFactors)[]).map(
              (key) => {
                const value = Math.max(0, Math.min(100, factors[key]));
                const weight = PRIORITY_CONFIG.weights[key];
                return (
                  <li key={key} className="ws-factor">
                    <div className="ws-factor-head">
                      <span className="ws-factor-name">
                        {FACTOR_NAMES[key]}
                      </span>
                      <span className="ws-factor-nums">
                        {Math.round(factors[key])} × {weight.toFixed(2)} ={" "}
                        <strong>+{(weight * factors[key]).toFixed(1)}</strong>
                      </span>
                    </div>
                    <div className="ws-bar" aria-hidden="true">
                      <span style={{ width: `${value}%` }} />
                    </div>
                    <p className="ap-muted ws-small">
                      {helper(key, row, issue)}
                    </p>
                  </li>
                );
              },
            )}
          </ul>
          <p className="ap-muted ws-small">
            Score = sum of weighted factors (each 0–100). Labels: Medium from{" "}
            {PRIORITY_CONFIG.label_thresholds.MEDIUM}, High from{" "}
            {PRIORITY_CONFIG.label_thresholds.HIGH}, Critical from{" "}
            {PRIORITY_CONFIG.label_thresholds.CRITICAL}.
          </p>
        </>
      )}
    </section>
  );
}

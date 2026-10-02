/**
 * Unit tests for src/config/civic.ts (no stack needed): `priorityLabel` boundaries, the 02 §5.10
 * demo calibration reproduced from PRIORITY_CONFIG, and the status-transition helpers (02 §4).
 *
 * SQL owns the factor math (`authority_queue`, 06 rule 16 / the PRIORITY_CONFIG comment), so the
 * reference implementation of 02 §5 below lives ONLY in this test file. It reads every number from
 * PRIORITY_CONFIG; if one of them drifts from the spec, the calibration rows (whose expected values
 * are copied from the 02 §5.10 table) stop matching.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  FEATURES,
  ISSUE_STATUSES,
  LEVELS,
  PRIORITY_CONFIG,
  allowedNextStatuses,
  canTransition,
  findTransition,
  openStatuses,
  priorityLabel,
  type IssueStatus,
  type Level,
  type SeveritySource,
} from "../../src/config/civic.ts";

// ---------------------------------------------------------------------------
// priorityLabel (02 §5.9)
// ---------------------------------------------------------------------------

describe("priorityLabel (02 §5.9)", () => {
  const t = PRIORITY_CONFIG.label_thresholds;

  test("thresholds are 25 / 40 / 55, inclusive lower bounds", () => {
    assert.deepEqual({ ...t }, { MEDIUM: 25, HIGH: 40, CRITICAL: 55 });
  });

  const cases: [number, Level][] = [
    [0, "LOW"],
    [t.MEDIUM - 0.01, "LOW"], // 24.99
    [t.MEDIUM, "MEDIUM"], // 25
    [t.HIGH - 0.01, "MEDIUM"], // 39.99
    [t.HIGH, "HIGH"], // 40
    [t.CRITICAL - 0.01, "HIGH"], // 54.99
    [t.CRITICAL, "CRITICAL"], // 55
    [100, "CRITICAL"],
  ];
  for (const [score, label] of cases) {
    test(`${score} → ${label}`, () => assert.equal(priorityLabel(score), label));
  }

  test("monotonic: never decreases as the score grows", () => {
    let prev = -1;
    for (let s = 0; s <= 100; s += 0.01) {
      const rank = LEVELS.indexOf(priorityLabel(s));
      assert.ok(rank >= prev, `label went down at ${s}`);
      prev = rank;
    }
  });
});

// ---------------------------------------------------------------------------
// Reference implementation of 02 §5 (test-only; SQL is the real one)
// ---------------------------------------------------------------------------

interface PriorityInput {
  authoritySeverity?: Level | null;
  citizenSeverity?: Level | null;
  /** Distinct reporter_user_id across the issue's reports. */
  distinctReporters: number;
  hoursSinceCreated: number;
  /** risk_value of every risk zone that intersects the issue (empty = outside every zone). */
  intersectingRiskValues: readonly number[];
  /** Other RESOLVED issues, same category, within the radius, resolved in the window. */
  recurrenceCount: number;
}

interface PriorityResult {
  effectiveSeverity: Level;
  severitySource: SeveritySource;
  factors: { severity: number; support: number; age: number; location_risk: number; recurrence: number };
  /** Unrounded. */
  score: number;
  label: Level;
}

function referencePriority(input: PriorityInput): PriorityResult {
  const c = PRIORITY_CONFIG;
  const cap = (v: number) => Math.min(c.factor_max, v);

  // §5.4 — authority → citizen → default.
  const [effectiveSeverity, severitySource]: [Level, SeveritySource] = input.authoritySeverity
    ? [input.authoritySeverity, "AUTHORITY"]
    : input.citizenSeverity
      ? [input.citizenSeverity, "CITIZEN"]
      : [c.default_severity, "DEFAULT"];

  const factors = {
    severity: c.severity_values[effectiveSeverity],
    support: cap(c.support_multiplier * Math.log2(1 + input.distinctReporters)), // §5.5
    age: cap((input.hoursSinceCreated / c.age_full_hours) * c.factor_max), // §5.6
    location_risk:
      input.intersectingRiskValues.length > 0 ? Math.max(...input.intersectingRiskValues) : c.default_location_risk, // §5.7
    recurrence: cap(c.recurrence_points_per_issue * input.recurrenceCount), // §5.8
  };
  const w = c.weights;
  const score = // §5.9
    w.severity * factors.severity +
    w.support * factors.support +
    w.age * factors.age +
    w.location_risk * factors.location_risk +
    w.recurrence * factors.recurrence;
  return { effectiveSeverity, severitySource, factors, score, label: priorityLabel(score) };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The seed's "Demo arterial road" zone around DEMO_SPOT (02 §14). */
const DEMO_ZONE_RISK = 80;

describe("PRIORITY_CONFIG against 02 §5", () => {
  test("weights (§5.3) sum to 1", () => {
    const sum = Object.values(PRIORITY_CONFIG.weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
  });

  // 02 §5.10 — the table, row by row (Score column exact to 2 decimals; Support column to 1).
  const calibration: { name: string; input: PriorityInput; support: number; score: number; label: Level; source: SeveritySource }[] = [
    {
      name: "demo pothole, first report (citizen HIGH, 1 reporter, demo zone)",
      input: { citizenSeverity: "HIGH", distinctReporters: 1, hoursSinceCreated: 0, intersectingRiskValues: [DEMO_ZONE_RISK], recurrenceCount: 0 },
      support: 25.0,
      score: 47.25,
      label: "HIGH",
      source: "CITIZEN",
    },
    {
      name: "after the second citizen attaches (2 reporters)",
      input: { citizenSeverity: "HIGH", distinctReporters: 2, hoursSinceCreated: 0, intersectingRiskValues: [DEMO_ZONE_RISK], recurrenceCount: 0 },
      support: 39.6,
      score: 50.17,
      label: "HIGH",
      source: "CITIZEN",
    },
    {
      name: "generic new report, no severity, outside zones",
      input: { distinctReporters: 1, hoursSinceCreated: 0, intersectingRiskValues: [], recurrenceCount: 0 },
      support: 25.0,
      score: 27.5,
      label: "MEDIUM",
      source: "DEFAULT",
    },
  ];
  for (const row of calibration) {
    test(`§5.10 calibration: ${row.name} → ${row.score} ${row.label}`, () => {
      const r = referencePriority(row.input);
      assert.equal(Math.round(r.factors.support * 10) / 10, row.support, `support ${r.factors.support}`);
      assert.equal(r.factors.age, 0);
      assert.equal(r.factors.recurrence, 0);
      assert.equal(round2(r.score), row.score, `score ${r.score}`);
      assert.equal(r.label, row.label);
      assert.equal(r.severitySource, row.source);
    });
  }

  test("§5.10 exact factor values the integration tests expect", () => {
    const first = referencePriority(calibration[0]!.input);
    assert.deepEqual(
      Object.fromEntries(Object.entries(first.factors).map(([k, v]) => [k, round2(v)])),
      { severity: 75, support: 25, age: 0, location_risk: 80, recurrence: 0 },
    );
    assert.equal(round2(referencePriority(calibration[1]!.input).factors.support), 39.62);
  });

  test("§5.4 effective severity: authority beats citizen beats default (MEDIUM); AI never enters", () => {
    const base = { distinctReporters: 1, hoursSinceCreated: 0, intersectingRiskValues: [], recurrenceCount: 0 };
    const both = referencePriority({ ...base, authoritySeverity: "LOW", citizenSeverity: "CRITICAL" });
    assert.deepEqual([both.effectiveSeverity, both.severitySource, both.factors.severity], ["LOW", "AUTHORITY", 25]);
    const none = referencePriority(base);
    assert.deepEqual([none.effectiveSeverity, none.severitySource, none.factors.severity], ["MEDIUM", "DEFAULT", 50]);
    assert.deepEqual({ ...PRIORITY_CONFIG.severity_values }, { LOW: 25, MEDIUM: 50, HIGH: 75, CRITICAL: 100 });
  });

  test("§5.5–§5.8 caps and edges", () => {
    const base = { citizenSeverity: "MEDIUM" as Level, distinctReporters: 1, hoursSinceCreated: 0, intersectingRiskValues: [], recurrenceCount: 0 };
    // Support: 25 per doubling of (1 + reporters); capped at 100 from 15 reporters (log2(16) = 4).
    assert.equal(referencePriority({ ...base, distinctReporters: 15 }).factors.support, 100);
    assert.ok(referencePriority({ ...base, distinctReporters: 14 }).factors.support < 100);
    assert.equal(referencePriority({ ...base, distinctReporters: 1000 }).factors.support, 100);
    // Age: 100 at 7 days (168 h), capped after that; 50 at 3.5 days.
    assert.equal(referencePriority({ ...base, hoursSinceCreated: 84 }).factors.age, 50);
    assert.equal(referencePriority({ ...base, hoursSinceCreated: 168 }).factors.age, 100);
    assert.equal(referencePriority({ ...base, hoursSinceCreated: 1000 }).factors.age, 100);
    // Location: the MAXIMUM intersecting zone, else 25.
    assert.equal(referencePriority({ ...base, intersectingRiskValues: [60, 80, 70] }).factors.location_risk, 80);
    assert.equal(referencePriority(base).factors.location_risk, 25);
    // Recurrence: 50 per resolved neighbour, capped at 100.
    assert.equal(referencePriority({ ...base, recurrenceCount: 1 }).factors.recurrence, 50);
    assert.equal(referencePriority({ ...base, recurrenceCount: 2 }).factors.recurrence, 100);
    assert.equal(referencePriority({ ...base, recurrenceCount: 5 }).factors.recurrence, 100);
    // Everything maxed → 100 (CRITICAL); minimum (LOW, 1 reporter, fresh, no zone) → 18.75 (LOW).
    const max = referencePriority({ authoritySeverity: "CRITICAL", distinctReporters: 15, hoursSinceCreated: 168, intersectingRiskValues: [100], recurrenceCount: 2 });
    assert.equal(round2(max.score), 100);
    assert.equal(max.label, "CRITICAL");
    const min = referencePriority({ ...base, citizenSeverity: "LOW" });
    assert.equal(round2(min.score), 18.75);
    assert.equal(min.label, "LOW");
  });

  test("§5.8 recurrence radius is the category radius (§3.2); window 90 days", () => {
    assert.equal(PRIORITY_CONFIG.recurrence_window_days, 90);
    assert.equal(PRIORITY_CONFIG.recurrence_radius_m_by_category.POTHOLE, 50);
  });

  test("the queue's default statuses are the open ones (reopen-aware)", () => {
    assert.deepEqual([...PRIORITY_CONFIG.queue_statuses], openStatuses());
  });
});

// ---------------------------------------------------------------------------
// Status transitions (02 §4)
// ---------------------------------------------------------------------------

describe("transition helpers (02 §4)", () => {
  const sorted = (xs: readonly IssueStatus[]) => [...xs].sort();

  const MAIN: Record<IssueStatus, IssueStatus[]> = {
    REPORTED: ["ASSIGNED", "REJECTED", "MERGED"],
    ASSIGNED: ["ASSIGNED", "IN_PROGRESS", "REJECTED", "MERGED"], // ASSIGNED → ASSIGNED = reassign
    IN_PROGRESS: ["ASSIGNED", "RESOLVED", "MERGED"],
    RESOLVED: [],
    REJECTED: [],
    MERGED: [],
    REOPENED: [],
  };
  const WITH_REOPEN: Record<IssueStatus, IssueStatus[]> = {
    ...MAIN,
    RESOLVED: ["REOPENED"],
    REOPENED: ["ASSIGNED", "IN_PROGRESS", "REJECTED", "MERGED"],
  };

  for (const from of ISSUE_STATUSES) {
    test(`allowedNextStatuses(${from}) — reopen off / on / default flag`, () => {
      assert.deepEqual(sorted(allowedNextStatuses(from, { reopenEnabled: false })), sorted(MAIN[from]));
      assert.deepEqual(sorted(allowedNextStatuses(from, { reopenEnabled: true })), sorted(WITH_REOPEN[from]));
      const expected = FEATURES.reopen ? WITH_REOPEN : MAIN;
      assert.deepEqual(sorted(allowedNextStatuses(from)), sorted(expected[from]));
    });
  }

  test("only REOPENED is open to citizens, and only with the stretch enabled", () => {
    for (const from of ISSUE_STATUSES) {
      assert.deepEqual(allowedNextStatuses(from, { actor: "CITIZEN", reopenEnabled: false }), [], from);
    }
    assert.deepEqual(allowedNextStatuses("RESOLVED", { actor: "CITIZEN", reopenEnabled: true }), ["REOPENED"]);
    assert.equal(canTransition("RESOLVED", "REOPENED", { reopenEnabled: false }), false);
    assert.equal(canTransition("RESOLVED", "REOPENED", { reopenEnabled: true }), true);
  });

  test("events, routes and required notes", () => {
    assert.equal(findTransition("REPORTED", "ASSIGNED")?.event, "ASSIGNED");
    assert.equal(findTransition("ASSIGNED", "ASSIGNED")?.event, "REASSIGNED");
    assert.equal(findTransition("IN_PROGRESS", "RESOLVED")?.action, "RESOLVE");
    assert.equal(findTransition("ASSIGNED", "IN_PROGRESS")?.action, "STATUS");
    assert.equal(findTransition("REPORTED", "REJECTED")?.requiresNote, true);
    assert.equal(findTransition("IN_PROGRESS", "MERGED")?.event, "MERGED_INTO");
    // Not allowed: skipping steps, rejecting work in progress, leaving a closed status.
    assert.equal(canTransition("REPORTED", "IN_PROGRESS"), false);
    assert.equal(canTransition("REPORTED", "RESOLVED"), false);
    assert.equal(canTransition("IN_PROGRESS", "REJECTED"), false);
    assert.equal(canTransition("REJECTED", "ASSIGNED"), false);
    assert.equal(canTransition("MERGED", "REPORTED"), false);
  });

  test("openStatuses excludes REOPENED unless reopen is enabled", () => {
    assert.deepEqual(openStatuses({ reopenEnabled: false }), ["REPORTED", "ASSIGNED", "IN_PROGRESS"]);
    assert.deepEqual(openStatuses({ reopenEnabled: true }), ["REPORTED", "ASSIGNED", "IN_PROGRESS", "REOPENED"]);
  });
});

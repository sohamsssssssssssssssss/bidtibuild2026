/**
 * Phase 4 gate rehearsal (docs/WORK_SPLIT.md: "the demo pothole shows HIGH with its breakdown,
 * before and after the second citizen attaches") and the 02 §5.10 calibration rows 1–2, run as the
 * judge demo (03 §6 steps 2–8) exactly at DEMO_SPOT.
 *
 * OPT-IN (RUN_DEMO_SPOT_TEST=1). It writes at DEMO_SPOT — the one place every other test avoids —
 * and leaves a RESOLVED pothole there. That pothole is a recurrence source (02 §5.8) for the next
 * one, so after this test the demo no longer scores 47.25 / 50.17: run `npm run demo:reset`
 * (`-- --local` for the local stack) before a real demo, and before running this test again. The
 * test checks first that DEMO_SPOT is clean (02 §14) and fails with that instruction if not.
 * Needs the authority account (AUTHORITY_EMAIL / AUTHORITY_PASSWORD) like the other authority tests.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_SPOT, OPEN_STATUSES, PRIORITY_CONFIG } from "../../src/config/civic.ts";
import type { AuthorityQueueRow } from "../../src/contracts/authority.ts";
import { departmentsResponseSchema } from "../../src/contracts/departments.ts";
import { issuesResponseSchema, setPriorityResponseSchema } from "../../src/contracts/issues.ts";
import {
  duplicateCandidatesResponseSchema,
  supportReportResponseSchema,
} from "../../src/contracts/reports.ts";
import {
  adminClient,
  api,
  assignIssue,
  authority,
  authorityTestOptions,
  bboxAround,
  distanceM,
  expectOk,
  expectPhoto,
  expectQueueRecommendation,
  expectTimeline,
  getIssue,
  getMyReports,
  getQueue,
  near,
  newCitizen,
  newIssue,
  offsetPoint,
  photoRoutePath,
  reportBody,
  resolveIssue,
  SCORE_TOLERANCE,
  startWork,
  uploadPhoto,
  type Authority,
} from "./helpers.ts";

const OPT_IN =
  process.env.RUN_DEMO_SPOT_TEST === "1"
    ? false
    : "opt-in: set RUN_DEMO_SPOT_TEST=1 — it reports and resolves a pothole AT DEMO_SPOT, so run `npm run demo:reset` afterwards, before a real demo";

/** The seed's "Demo arterial road" zone, which contains DEMO_SPOT (02 §14). */
const DEMO_ZONE_RISK = 80;
const DAY_MS = 86_400_000;

/**
 * 02 §14 "clear demo spot": no open POTHOLE within the pothole radius of DEMO_SPOT (it would be
 * offered as a duplicate) and no POTHOLE resolved there within the recurrence window (recurrence
 * would break the calibration). Uses the public map (open + RESOLVED markers) around DEMO_SPOT.
 */
async function expectCleanDemoSpot(): Promise<void> {
  const radius = PRIORITY_CONFIG.recurrence_radius_m_by_category.POTHOLE;
  const markers = expectOk(
    await api("GET", `/api/issues?bbox=${bboxAround(DEMO_SPOT, 0.002)}&category=POTHOLE`, { ip: null }),
    issuesResponseSchema,
  ).filter((m) => distanceM(m, DEMO_SPOT) <= radius + 5); // +5 m: haversine vs PostGIS spheroid

  const open = markers.filter((m) => (OPEN_STATUSES as readonly string[]).includes(m.status));
  const resolvedIds = markers.filter((m) => m.status === "RESOLVED").map((m) => m.id);
  let recent: string[] = [];
  if (resolvedIds.length > 0) {
    const { data, error } = await adminClient().from("issues").select("id, resolved_at").in("id", resolvedIds);
    if (error) throw new Error(`issues lookup failed: ${error.message}`);
    const since = Date.now() - PRIORITY_CONFIG.recurrence_window_days * DAY_MS;
    recent = (data as { id: string; resolved_at: string | null }[])
      .filter((r) => r.resolved_at !== null && Date.parse(r.resolved_at) >= since)
      .map((r) => r.id);
  }
  assert.ok(
    open.length === 0 && recent.length === 0,
    `DEMO_SPOT is not clean (02 §14): open potholes ${JSON.stringify(open.map((m) => m.id))}, ` +
      `recently resolved potholes ${JSON.stringify(recent)} within ${radius} m — ` +
      "run `npm run demo:reset -- --local` (an earlier run of this test leaves one behind)",
  );
}

async function demoRow(auth: Authority, issueId: string): Promise<AuthorityQueueRow> {
  const row = (await getQueue(auth, "?category=POTHOLE")).find((r) => r.id === issueId);
  assert.ok(row, "the demo pothole is missing from the authority queue");
  return row;
}

/** The 02 §5.10 breakdown of the demo pothole: citizen HIGH, demo zone, fresh, no recurrence. */
function expectDemoBreakdown(row: AuthorityQueueRow, reporters: number, support: number, score: number): void {
  expectQueueRecommendation(row);
  assert.equal(row.distinct_reporter_count, reporters, "distinct_reporter_count");
  assert.equal(row.report_count, reporters, "report_count");
  assert.equal(row.effective_severity, "HIGH");
  assert.equal(row.severity_source, "CITIZEN");
  assert.equal(row.recurrence_count, 0, "a resolved pothole near DEMO_SPOT — run `npm run demo:reset`");
  assert.equal(row.factors.severity, 75, "severity");
  near(row.factors.support, support, 0.005, "support");
  near(row.factors.age, 0, 0.1, "age (fresh issue)");
  assert.equal(row.factors.location_risk, DEMO_ZONE_RISK, "location_risk: DEMO_SPOT must be inside the seeded 80 zone");
  assert.equal(row.factors.recurrence, 0, "recurrence");
  near(row.score, score, SCORE_TOLERANCE, "score");
  assert.equal(row.label, "HIGH", `label for score ${row.score}`);
}

test(
  "Phase 4 gate at DEMO_SPOT: pothole HIGH 47.25 → B attaches → HIGH 50.17; then priority, Roads, start, resolve; A sees RESOLVED + evidence",
  authorityTestOptions({ skip: OPT_IN }),
  async () => {
    const auth = await authority();
    await expectCleanDemoSpot();

    // 2. Citizen A reports a pothole exactly at DEMO_SPOT with severity HIGH.
    const a = await newIssue({
      body: { category: "POTHOLE", citizen_severity: "HIGH", lat: DEMO_SPOT.lat, lng: DEMO_SPOT.lng },
    });

    // Gate, before: 0.35×75 + 0.20×25 + 0.15×0 + 0.20×80 + 0.10×0 = 47.25 → HIGH (02 §5.10 row 1).
    expectDemoBreakdown(await demoRow(auth, a.issueId), 1, 25, 47.25);

    // 3. Citizen B, ~10 m away: A's pothole is the first candidate; B chooses "This is the same issue".
    const b = await newCitizen();
    const bAt = offsetPoint(DEMO_SPOT.lat, DEMO_SPOT.lng, 8, -6); // 10 m
    const list = expectOk(
      await api("GET", `/api/duplicate-candidates?lat=${bAt.lat}&lng=${bAt.lng}&category=POTHOLE`, { token: b.accessToken }),
      duplicateCandidatesResponseSchema,
    );
    const first = list[0];
    assert.ok(first, "no duplicate candidate 10 m from the demo pothole");
    assert.equal(first.id, a.issueId);
    assert.equal(first.match, "EXACT");
    assert.ok(Math.abs(first.distance_m - 10) <= 0.5, `distance_m ${first.distance_m}, expected ≈ 10`);
    const supportBody = reportBody(await uploadPhoto(b), {
      category: "POTHOLE",
      citizen_severity: "HIGH",
      lat: bAt.lat,
      lng: bAt.lng,
    });
    const attached = expectOk(
      await api("POST", `/api/issues/${a.issueId}/support`, { token: b.accessToken, body: supportBody }),
      supportReportResponseSchema,
      [201],
    );
    assert.equal(attached.issue_id, a.issueId);
    assert.equal(attached.created_new_issue, false);

    // Gate, after: support 25×log2(3) ≈ 39.62 → 50.17 → still HIGH (02 §5.10 row 2). The second
    // decimal is age-sensitive (50.1748 at age 0), hence SCORE_TOLERANCE.
    expectDemoBreakdown(await demoRow(auth, a.issueId), 2, 39.62, 50.17);

    // 4. The authority sets final priority HIGH; the recommendation is unaffected (02 §5.1).
    const prio = expectOk(
      await api("PATCH", `/api/issues/${a.issueId}/priority`, { token: auth.accessToken, body: { final_priority: "HIGH" } }),
      setPriorityResponseSchema,
    );
    assert.equal(prio.final_priority, "HIGH");
    const prioritised = await demoRow(auth, a.issueId);
    assert.equal(prioritised.final_priority, "HIGH");
    expectDemoBreakdown(prioritised, 2, 39.62, 50.17);

    // 5. Assign the suggested department: the one whose default_categories contain POTHOLE (Roads).
    const departments = expectOk(await api("GET", "/api/departments", { token: auth.accessToken }), departmentsResponseSchema);
    const suggested = departments.filter((d) => (d.default_categories as readonly string[]).includes("POTHOLE"));
    assert.deepEqual(suggested.map((d) => d.name), ["Roads"]);
    assert.equal((await assignIssue(auth, a.issueId, suggested[0]!.id)).status, "ASSIGNED");

    // 6. Start work → IN_PROGRESS.
    assert.equal((await startWork(auth, a.issueId)).status, "IN_PROGRESS");

    // 7. Upload the after-photo → RESOLVED; the issue leaves the queue.
    const resolved = await resolveIssue(auth, a.issueId, "[integration test] demo-spot rehearsal: pothole filled");
    assert.equal(resolved.status, "RESOLVED");
    assert.ok(!(await getQueue(auth)).some((r) => r.id === a.issueId), "a RESOLVED issue is still in the queue");

    // 8. Citizen A sees RESOLVED with the evidence (and so does B).
    const evidenceUrl = photoRoutePath("evidence", resolved.evidence.id);
    for (const who of [a.citizen, b]) {
      const mine = await getMyReports(who);
      assert.equal(mine.length, 1);
      const issue = mine[0]!.issue;
      assert.equal(issue.id, a.issueId);
      assert.equal(issue.status, "RESOLVED");
      assert.equal(issue.final_priority, "HIGH");
      assert.equal(issue.report_count, 2);
      assert.equal(issue.latest_resolution_evidence?.id, resolved.evidence.id);
      assert.equal(issue.latest_resolution_evidence?.image_url, evidenceUrl);
      await expectPhoto(evidenceUrl, { token: who.accessToken });
    }

    const detail = await getIssue(a.issueId);
    assert.equal(detail.status, "RESOLVED");
    assert.deepEqual(detail.resolution_evidence.map((e) => e.id), [resolved.evidence.id]);
    expectTimeline(
      detail.timeline,
      [["CREATED"], ["SUPPORT_ADDED"], ["PRIORITY_SET"], ["ASSIGNED"], ["STATUS_CHANGED"], ["RESOLVED"]],
      ["CITIZEN", "CITIZEN", "AUTHORITY", "AUTHORITY", "AUTHORITY", "AUTHORITY"],
    );
  },
);

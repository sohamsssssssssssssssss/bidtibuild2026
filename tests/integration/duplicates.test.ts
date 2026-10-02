/**
 * Phase 3 — duplicates, supporting reports and authority merge through the API (02 §3, §4, §9,
 * §13, §15; phase-3 contract), plus the judge-demo path (03 §6 steps 2–8) at a random spot. The
 * same path AT DEMO_SPOT, with the exact 02 §5.10 numbers, is the opt-in demo-spot.test.ts.
 *
 * Points are random spots in northern Mumbai (randomMumbaiPoint: ≥ 2 km from DEMO_SPOT and the
 * City Pulse scenario) with metre offsets from offsetPoint; DEMO_SPOT itself is never used, so the
 * demo stays clean. Each citizen is fresh (5 reports/hour each). Tests that need the authority
 * account are skipped without AUTHORITY_EMAIL / AUTHORITY_PASSWORD. Rows stay until `demo:reset`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DUPLICATE_CONFIG, type Category } from "../../src/config/civic.ts";
import {
  issueDetailResponseSchema,
  issuesResponseSchema,
  mergeIssueResponseSchema,
  setPriorityResponseSchema,
} from "../../src/contracts/issues.ts";
import {
  duplicateCandidatesResponseSchema,
  supportReportResponseSchema,
  type CreateReportBodyInput,
  type DuplicateCandidate,
} from "../../src/contracts/reports.ts";
import { departmentsResponseSchema } from "../../src/contracts/departments.ts";
import {
  api,
  assignIssue,
  assignStartResolve,
  authority,
  authorityTestOptions,
  bboxAround,
  countReportsBy,
  expectError,
  expectOk,
  expectPhoto,
  expectQueueRecommendation,
  expectTimeline,
  getIssue,
  getMyReports,
  getQueue,
  jsonStrings,
  near,
  newCitizen,
  newIssue,
  offsetPoint,
  photoRoutePath,
  PRIVATE_KEYS,
  reportBody,
  resolveIssue,
  startWork,
  testOptions,
  uploadPhoto,
  type Authority,
  type Citizen,
  type LatLng,
} from "./helpers.ts";

const COORD_EPSILON = 1e-6;
/** distance_m is rounded to 0.1 m in SQL; offsetPoint is accurate to millimetres. */
const DISTANCE_TOLERANCE_M = 0.5;

// Friendly messages fixed by the phase-3 contract.
const ISSUE_NOT_FOUND = "Issue not found.";
const SUPPORT_CLOSED =
  "This issue is already closed, so it can't take new reports. Please create a new issue instead.";
const SUPPORT_CATEGORY_MISMATCH = "That category doesn't match this issue.";
const MERGE_INVALID_TRANSITION = "This issue can't be merged from its current status.";
const MERGE_TARGET_CLOSED = "The target issue is closed.";
const MERGE_SELF = "Pick a different issue to merge into.";

function moved(p: LatLng, metersNorth: number, metersEast: number): LatLng {
  return offsetPoint(p.lat, p.lng, metersNorth, metersEast);
}

async function candidates(who: { accessToken: string }, at: LatLng, category: Category): Promise<DuplicateCandidate[]> {
  const res = await api("GET", `/api/duplicate-candidates?lat=${at.lat}&lng=${at.lng}&category=${category}`, {
    token: who.accessToken,
  });
  const list = expectOk(res, duplicateCandidatesResponseSchema);
  expectRanked(list);
  return list;
}

/** 02 §3.5: EXACT before FAMILY, then distance ascending (then newest first). */
function expectRanked(list: readonly DuplicateCandidate[]): void {
  const key = (c: DuplicateCandidate) => [c.match === "EXACT" ? 0 : 1, c.distance_m] as const;
  for (let i = 1; i < list.length; i++) {
    const [ma, da] = key(list[i - 1]!);
    const [mb, db] = key(list[i]!);
    assert.ok(ma < mb || (ma === mb && da <= db), `candidates out of order: ${JSON.stringify(list)}`);
  }
}

/** POST /api/issues/:id/support with a fresh photo; `at` is where the supporter pinned it. */
async function postSupport(
  citizen: Citizen,
  issueId: string,
  at: LatLng,
  overrides: Partial<CreateReportBodyInput> = {},
) {
  const body = reportBody(await uploadPhoto(citizen), { lat: at.lat, lng: at.lng, ...overrides });
  const res = await api("POST", `/api/issues/${issueId}/support`, { token: citizen.accessToken, body });
  return { res, body };
}

async function support(citizen: Citizen, issueId: string, at: LatLng, overrides: Partial<CreateReportBodyInput> = {}) {
  const { res, body } = await postSupport(citizen, issueId, at, overrides);
  const data = expectOk(res, supportReportResponseSchema, [201]);
  assert.equal(data.created_new_issue, false);
  return { ...data, body };
}

function merge(who: { accessToken?: string } | null, sourceId: string, targetId: string, note?: string) {
  return api("POST", `/api/issues/${sourceId}/merge`, {
    token: who?.accessToken,
    body: { target_issue_id: targetId, ...(note === undefined ? {} : { note }) },
  });
}

async function onMap(issueId: string, at: LatLng): Promise<boolean> {
  const markers = expectOk(await api("GET", `/api/issues?bbox=${bboxAround(at)}`, { ip: null }), issuesResponseSchema);
  return markers.some((m) => m.id === issueId);
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

test("candidates: same category within the radius, nearest first; outside the radius or another category → not returned", testOptions(), async () => {
  const a = await newIssue({ body: { category: "POTHOLE" } });
  const b = await newCitizen();
  const radius = DUPLICATE_CONFIG.radius_m_by_category.POTHOLE;

  // ~20 m away: A's issue is the first candidate, EXACT.
  const near = moved(a.point, 12, 16); // 20 m
  const list = await candidates(b, near, "POTHOLE");
  const first = list[0];
  assert.ok(first, "no candidates 20 m from a fresh pothole");
  assert.equal(first.id, a.issueId);
  assert.equal(first.match, "EXACT");
  assert.equal(first.category, "POTHOLE");
  assert.equal(first.status, "REPORTED");
  assert.equal(first.report_count, 1);
  assert.ok(Math.abs(first.distance_m - 20) <= DISTANCE_TOLERANCE_M, `distance_m ${first.distance_m}, expected ≈ 20`);
  assert.ok(Math.abs(first.lat - a.point.lat) < COORD_EPSILON && Math.abs(first.lng - a.point.lng) < COORD_EPSILON);
  // The primary (only) report's photo, through the photo route.
  assert.equal(first.image_url, photoRoutePath("report", a.reportId));
  await expectPhoto(first.image_url!, { token: b.accessToken });
  // Privacy: no reporter id or storage path in the response.
  const raw = await api("GET", `/api/duplicate-candidates?lat=${near.lat}&lng=${near.lng}&category=POTHOLE`, {
    token: b.accessToken,
  });
  for (const s of jsonStrings(raw.json)) {
    assert.ok(!s.includes(a.citizen.userId), `candidates leak the reporter uid in ${JSON.stringify(s)}`);
    assert.ok(!(PRIVATE_KEYS as readonly string[]).includes(s), `candidates expose key ${s}`);
  }

  // Just inside the radius → still returned; ~70 m (outside the 50 m pothole radius) → not.
  const inside = (await candidates(b, moved(a.point, -(radius - 5), 0), "POTHOLE")).find((c) => c.id === a.issueId);
  assert.ok(inside, `not returned ${radius - 5} m away`);
  assert.ok(Math.abs(inside.distance_m - (radius - 5)) <= DISTANCE_TOLERANCE_M);
  assert.ok(!(await candidates(b, moved(a.point, 0, 70), "POTHOLE")).some((c) => c.id === a.issueId), "returned 70 m away");

  // Another category at the same 20 m point (GARBAGE's own radius is 75 m) → not returned.
  assert.ok(!(await candidates(b, near, "GARBAGE")).some((c) => c.id === a.issueId), "a GARBAGE query matched a POTHOLE");

  // Signed-in callers only; the query is validated.
  expectError(
    await api("GET", `/api/duplicate-candidates?lat=${near.lat}&lng=${near.lng}&category=POTHOLE`),
    401,
    "UNAUTHENTICATED",
  );
  expectError(
    await api("GET", `/api/duplicate-candidates?lat=${near.lat}&lng=${near.lng}`, { token: b.accessToken }),
    400,
    "VALIDATION_FAILED",
  );
  expectError(
    await api("GET", `/api/duplicate-candidates?lat=95&lng=${near.lng}&category=POTHOLE`, { token: b.accessToken }),
    400,
    "VALIDATION_FAILED",
  );
});

test("candidates: compatible family (WATERLOGGING / DRAINAGE / WATER_LEAK) → FAMILY, ranked after EXACT; support across the family", testOptions(), async () => {
  const reporter = await newCitizen();
  const waterlogging = await newIssue({ citizen: reporter, body: { category: "WATERLOGGING" } });
  const p = waterlogging.point;
  const drainage = await newIssue({ citizen: reporter, body: { category: "DRAINAGE", ...moved(p, 120, 0) } });
  const b = await newCitizen();
  const q = moved(p, 0, 20); // 20 m from the waterlogging issue, ≈ 121.7 m from the drainage one

  // DRAINAGE (radius 150 m): the EXACT drainage issue ranks before the nearer FAMILY one.
  const asDrainage = await candidates(b, q, "DRAINAGE");
  const iExact = asDrainage.findIndex((c) => c.id === drainage.issueId);
  const iFamily = asDrainage.findIndex((c) => c.id === waterlogging.issueId);
  assert.ok(iExact >= 0 && iFamily >= 0, JSON.stringify(asDrainage));
  assert.ok(iExact < iFamily, "EXACT must rank before FAMILY regardless of distance");
  assert.equal(asDrainage[iExact]!.match, "EXACT");
  assert.equal(asDrainage[iFamily]!.match, "FAMILY");
  assert.equal(asDrainage[iFamily]!.category, "WATERLOGGING");
  assert.ok(Math.abs(asDrainage[iFamily]!.distance_m - 20) <= DISTANCE_TOLERANCE_M);
  assert.ok(Math.abs(asDrainage[iExact]!.distance_m - Math.hypot(120, 20)) <= DISTANCE_TOLERANCE_M);

  // WATERLOGGING: now the waterlogging issue is EXACT and first.
  const asWaterlogging = await candidates(b, q, "WATERLOGGING");
  assert.equal(asWaterlogging[0]?.id, waterlogging.issueId);
  assert.equal(asWaterlogging[0]?.match, "EXACT");
  assert.equal(asWaterlogging.find((c) => c.id === drainage.issueId)?.match, "FAMILY");

  // WATER_LEAK uses ITS radius (75 m): the 20 m waterlogging issue matches, the ≈ 122 m drainage one doesn't.
  const asLeak = await candidates(b, q, "WATER_LEAK");
  assert.equal(asLeak.find((c) => c.id === waterlogging.issueId)?.match, "FAMILY");
  assert.ok(!asLeak.some((c) => c.id === drainage.issueId), "WATER_LEAK must use its own 75 m radius");

  // Outside the family: nothing.
  const asPothole = await candidates(b, q, "POTHOLE");
  assert.ok(!asPothole.some((c) => c.id === waterlogging.issueId || c.id === drainage.issueId));

  // B attaches a DRAINAGE report to the WATERLOGGING issue (same family) → accepted.
  const attached = await support(b, waterlogging.issueId, q, { category: "DRAINAGE" });
  assert.equal(attached.issue_id, waterlogging.issueId);
  const detail = await getIssue(waterlogging.issueId);
  assert.equal(detail.category, "WATERLOGGING", "a supporting report never changes the issue's category");
  assert.equal(detail.report_count, 2);
});

// ---------------------------------------------------------------------------
// Supporting reports
// ---------------------------------------------------------------------------

test("support: B attaches to A's issue → 201; counts, timeline, My Reports; A's issue otherwise unchanged", testOptions(), async () => {
  const a = await newIssue({ body: { category: "POTHOLE", citizen_severity: "MEDIUM" } });
  const b = await newCitizen();
  const at = moved(a.point, 15, 0);

  // Wrong category for this issue → 400 with the contract's message; nothing is written.
  const { res: wrong } = await postSupport(b, a.issueId, at, { category: "GARBAGE" });
  assert.equal(expectError(wrong, 400, "VALIDATION_FAILED"), SUPPORT_CATEGORY_MISMATCH);
  // Someone else's photo → 403; no session → 401; unknown issue → 404.
  const foreign = reportBody(a.body.image_path, { category: "POTHOLE", lat: at.lat, lng: at.lng });
  expectError(await api("POST", `/api/issues/${a.issueId}/support`, { token: b.accessToken, body: foreign }), 403, "FORBIDDEN");
  const own = reportBody(await uploadPhoto(b), { category: "POTHOLE", lat: at.lat, lng: at.lng });
  expectError(await api("POST", `/api/issues/${a.issueId}/support`, { body: own }), 401, "UNAUTHENTICATED");
  assert.equal(
    expectError(await api("POST", `/api/issues/${randomUUID()}/support`, { token: b.accessToken, body: own }), 404, "NOT_FOUND"),
    ISSUE_NOT_FOUND,
  );
  assert.equal(await countReportsBy(b.userId), 0, "a rejected support request created a report");

  // The real thing.
  const description = `[integration test] same pothole ${randomUUID().slice(0, 8)}`;
  const attached = await support(b, a.issueId, at, { category: "POTHOLE", citizen_severity: "HIGH", description });
  assert.equal(attached.issue_id, a.issueId);
  assert.notEqual(attached.report_id, a.reportId);

  // Public detail: 2 reports, A's status / severity / location / priority untouched.
  const detailRes = await api("GET", `/api/issues/${a.issueId}`, { ip: null });
  const detail = expectOk(detailRes, issueDetailResponseSchema);
  assert.equal(detail.report_count, 2);
  assert.equal(detail.status, "REPORTED");
  assert.equal(detail.category, "POTHOLE");
  assert.equal(detail.citizen_severity, "MEDIUM");
  assert.equal(detail.final_priority, null);
  assert.ok(Math.abs(detail.lat - a.point.lat) < COORD_EPSILON && Math.abs(detail.lng - a.point.lng) < COORD_EPSILON);
  assert.deepEqual(
    detail.photos.map((ph) => [ph.id, ph.image_url]),
    [
      [a.reportId, photoRoutePath("report", a.reportId)],
      [attached.report_id, photoRoutePath("report", attached.report_id)],
    ],
  );
  expectTimeline(detail.timeline, [["CREATED"], ["SUPPORT_ADDED"]], ["CITIZEN", "CITIZEN"]);
  assert.deepEqual([detail.timeline[1]!.from_status, detail.timeline[1]!.to_status], [null, null]);
  for (const s of jsonStrings(detailRes.json)) {
    assert.ok(!s.includes(b.userId), `issue detail leaks the supporter uid in ${JSON.stringify(s)}`);
  }
  await expectPhoto(photoRoutePath("report", attached.report_id));

  // The map marker and the candidate list show the new count.
  const markers = expectOk(await api("GET", `/api/issues?bbox=${bboxAround(a.point)}`, { ip: null }), issuesResponseSchema);
  assert.equal(markers.find((m) => m.id === a.issueId)?.report_count, 2);
  assert.equal((await candidates(b, at, "POTHOLE")).find((c) => c.id === a.issueId)?.report_count, 2);

  // B's My Reports: B's own report (B's pin, photo, text) on A's issue.
  const mineB = await getMyReports(b);
  assert.equal(mineB.length, 1);
  assert.equal(mineB[0]!.id, attached.report_id);
  assert.equal(mineB[0]!.description, description);
  assert.equal(mineB[0]!.citizen_severity, "HIGH");
  assert.ok(Math.abs(mineB[0]!.lat - at.lat) < COORD_EPSILON && Math.abs(mineB[0]!.lng - at.lng) < COORD_EPSILON);
  assert.equal(mineB[0]!.issue.id, a.issueId);
  assert.equal(mineB[0]!.issue.status, "REPORTED");
  assert.equal(mineB[0]!.issue.report_count, 2);
  await expectPhoto(mineB[0]!.image_url!, { token: b.accessToken });
  // A's My Reports: still only A's report, now on a 2-report issue.
  const mineA = await getMyReports(a.citizen);
  assert.deepEqual(mineA.map((r) => [r.id, r.issue.id, r.issue.report_count]), [[a.reportId, a.issueId, 2]]);
  assert.equal(await countReportsBy(b.userId), 1);
});

test(
  "closed issues: support on a RESOLVED issue → 409; merging a RESOLVED source / into a RESOLVED target → 409",
  authorityTestOptions(),
  async () => {
    const auth = await authority();
    const resolved = await newIssue({ body: { category: "POTHOLE" } });
    await assignStartResolve(auth, resolved.issueId);
    const open = await newIssue({ body: { category: "POTHOLE" } });
    const b = await newCitizen();
    const at = moved(resolved.point, 10, 0);

    // Resolved issues are not candidates and take no new reports.
    assert.ok(!(await candidates(b, at, "POTHOLE")).some((c) => c.id === resolved.issueId), "a RESOLVED issue is a candidate");
    const { res } = await postSupport(b, resolved.issueId, at, { category: "POTHOLE" });
    assert.equal(expectError(res, 409, "CONFLICT"), SUPPORT_CLOSED);
    assert.equal(await countReportsBy(b.userId), 0);

    // Merge: source must be open (INVALID_TRANSITION), target must be open (CONFLICT).
    assert.equal(expectError(await merge(auth, resolved.issueId, open.issueId), 409, "INVALID_TRANSITION"), MERGE_INVALID_TRANSITION);
    assert.equal(expectError(await merge(auth, open.issueId, resolved.issueId), 409, "CONFLICT"), MERGE_TARGET_CLOSED);

    assert.equal((await getIssue(resolved.issueId)).report_count, 1);
    const openDetail = await getIssue(open.issueId);
    assert.equal(openDetail.status, "REPORTED");
    assert.equal(openDetail.merged_into_issue_id, null);
  },
);

// ---------------------------------------------------------------------------
// Authority merge
// ---------------------------------------------------------------------------

test("merge: moves every report to the target, no chains, My Reports follow; errors", authorityTestOptions(), async () => {
  const auth = await authority();
  const source = await newIssue();
  const earlier = await newIssue({ body: moved(source.point, 30, 0) }); // merged into source first
  const target = await newIssue();

  // --- Access and validation -------------------------------------------------------------------------
  expectError(await merge(null, source.issueId, target.issueId), 401, "UNAUTHENTICATED");
  expectError(await merge(source.citizen, source.issueId, target.issueId), 403, "FORBIDDEN");
  assert.equal(expectError(await merge(auth, source.issueId, source.issueId), 400, "VALIDATION_FAILED"), MERGE_SELF);
  assert.equal(expectError(await merge(auth, source.issueId, source.issueId.toUpperCase()), 400, "VALIDATION_FAILED"), MERGE_SELF);
  assert.equal(expectError(await merge(auth, source.issueId, randomUUID()), 404, "NOT_FOUND"), ISSUE_NOT_FOUND);
  assert.equal(expectError(await merge(auth, randomUUID(), target.issueId), 404, "NOT_FOUND"), ISSUE_NOT_FOUND);
  expectError(
    await api("POST", `/api/issues/${source.issueId}/merge`, { token: auth.accessToken, body: { target_issue_id: "nope" } }),
    400,
    "VALIDATION_FAILED",
  );
  assert.equal((await getIssue(source.issueId)).status, "REPORTED");

  // --- earlier → source, then source → target ----------------------------------------------------------
  const first = expectOk(await merge(auth, earlier.issueId, source.issueId), mergeIssueResponseSchema);
  assert.deepEqual(first, {
    source_issue_id: earlier.issueId,
    target_issue_id: source.issueId,
    moved_report_ids: [earlier.reportId],
  });
  const note = `[integration test] same spot ${randomUUID().slice(0, 8)}`;
  const second = expectOk(await merge(auth, source.issueId, target.issueId, `  ${note}  `), mergeIssueResponseSchema);
  assert.equal(second.source_issue_id, source.issueId);
  assert.equal(second.target_issue_id, target.issueId);
  // Every report now on the source, oldest first (source's own was created before `earlier`'s).
  assert.deepEqual(second.moved_report_ids, [source.reportId, earlier.reportId]);

  // Source: MERGED into the target, no reports left.
  const src = await getIssue(source.issueId);
  assert.equal(src.status, "MERGED");
  assert.equal(src.merged_into_issue_id, target.issueId);
  assert.equal(src.report_count, 0);
  expectTimeline(src.timeline, [["CREATED"], ["MERGED_FROM"], ["MERGED_INTO"]], ["CITIZEN", "AUTHORITY", "AUTHORITY"]);
  const mergedInto = src.timeline[2]!;
  assert.deepEqual([mergedInto.from_status, mergedInto.to_status, mergedInto.note], ["REPORTED", "MERGED", note]);

  // No chains: the issue merged into the source earlier now points straight at the target.
  const prev = await getIssue(earlier.issueId);
  assert.equal(prev.status, "MERGED");
  assert.equal(prev.merged_into_issue_id, target.issueId);

  // Target: all three reports; keeps its own location, category, status.
  const tgt = await getIssue(target.issueId);
  assert.equal(tgt.status, "REPORTED");
  assert.equal(tgt.merged_into_issue_id, null);
  assert.equal(tgt.report_count, 3);
  assert.equal(tgt.category, "OTHER");
  assert.ok(Math.abs(tgt.lat - target.point.lat) < COORD_EPSILON && Math.abs(tgt.lng - target.point.lng) < COORD_EPSILON);
  assert.deepEqual(new Set(tgt.photos.map((ph) => ph.id)), new Set([target.reportId, source.reportId, earlier.reportId]));
  expectTimeline(tgt.timeline, [["CREATED"], ["MERGED_FROM"]], ["CITIZEN", "AUTHORITY"]);
  const mergedFrom = tgt.timeline[1]!;
  assert.deepEqual([mergedFrom.from_status, mergedFrom.to_status, mergedFrom.note], [null, null, note]);

  // Merged issues leave the map and the candidate list; the target is on the map with 3 reports.
  assert.equal(await onMap(source.issueId, source.point), false, "a MERGED issue is still on the map");
  assert.equal(await onMap(earlier.issueId, earlier.point), false, "a MERGED issue is still on the map");
  assert.ok(!(await candidates(source.citizen, source.point, "OTHER")).some((c) => c.id === source.issueId));
  const markers = expectOk(await api("GET", `/api/issues?bbox=${bboxAround(target.point)}`, { ip: null }), issuesResponseSchema);
  assert.equal(markers.find((m) => m.id === target.issueId)?.report_count, 3);

  // My Reports follow the report rows: both earlier reporters now see the target issue.
  for (const who of [source, earlier]) {
    const mine = await getMyReports(who.citizen);
    assert.deepEqual(
      mine.map((r) => [r.id, r.issue.id, r.issue.status, r.issue.report_count]),
      [[who.reportId, target.issueId, "REPORTED", 3]],
    );
  }

  // Merging again: a MERGED source can't move; a MERGED target is closed.
  assert.equal(expectError(await merge(auth, source.issueId, target.issueId), 409, "INVALID_TRANSITION"), MERGE_INVALID_TRANSITION);
  assert.equal(expectError(await merge(auth, target.issueId, source.issueId), 409, "CONFLICT"), MERGE_TARGET_CLOSED);

  // A supporting report sent to the merged source lands on the target (and says so).
  const late = await newCitizen();
  const attached = await support(late, source.issueId, source.point, { category: "OTHER" });
  assert.equal(attached.issue_id, target.issueId);
  assert.equal((await getIssue(target.issueId)).report_count, 4);
  assert.equal((await getIssue(source.issueId)).report_count, 0);
  assert.equal((await getMyReports(late))[0]?.issue.id, target.issueId);
});

// ---------------------------------------------------------------------------
// Judge demo (03 §6 steps 2–8) at a random spot; at DEMO_SPOT see demo-spot.test.ts
// ---------------------------------------------------------------------------

test("judge demo: A reports, B joins, authority sets HIGH, assigns Roads, starts, resolves; A sees RESOLVED + evidence", authorityTestOptions(), async () => {
  const auth: Authority = await authority();

  // 2. Citizen A reports a pothole (severity HIGH) — at a random spot, never DEMO_SPOT itself.
  const a = await newIssue({ body: { category: "POTHOLE", citizen_severity: "HIGH" } });

  // 3. Citizen B, a few metres away: the duplicate candidate appears; B chooses "This is the same issue".
  const b = await newCitizen();
  const bAt = moved(a.point, 8, -6); // 10 m
  const [candidate] = await candidates(b, bAt, "POTHOLE");
  assert.equal(candidate?.id, a.issueId);
  assert.equal(candidate?.match, "EXACT");
  const attached = await support(b, a.issueId, bAt, { category: "POTHOLE", citizen_severity: "HIGH" });
  assert.equal(attached.issue_id, a.issueId);

  // 4. Authority opens the issue: two distinct reporters and the breakdown; sets final priority HIGH.
  //    (Outside the demo zone the score is 0.35×75 + 0.20×39.62 + 0.20×25 ≈ 39.17, MEDIUM — the
  //    HIGH label of 02 §5.10 needs DEMO_SPOT's risk zone; demo-spot.test.ts checks that.)
  const row = (await getQueue(auth, "?category=POTHOLE")).find((r) => r.id === a.issueId);
  assert.ok(row, "the demo issue is missing from the queue");
  assert.equal(row.report_count, 2);
  assert.equal(row.distinct_reporter_count, 2);
  assert.equal(row.effective_severity, "HIGH");
  assert.equal(row.severity_source, "CITIZEN");
  expectQueueRecommendation(row);
  assert.equal(row.factors.severity, 75);
  near(row.factors.support, 39.62, 0.005, "support with two reporters");
  const prio = expectOk(
    await api("PATCH", `/api/issues/${a.issueId}/priority`, { token: auth.accessToken, body: { final_priority: "HIGH" } }),
    setPriorityResponseSchema,
  );
  assert.equal(prio.final_priority, "HIGH");

  // 5. Assign the suggested department: the one whose default_categories contain POTHOLE (Roads).
  const departments = expectOk(await api("GET", "/api/departments", { token: auth.accessToken }), departmentsResponseSchema);
  const suggested = departments.filter((d) => (d.default_categories as readonly string[]).includes("POTHOLE"));
  assert.deepEqual(suggested.map((d) => d.name), ["Roads"]);
  const assigned = await assignIssue(auth, a.issueId, suggested[0]!.id);
  assert.equal(assigned.status, "ASSIGNED");

  // 6. Start work → IN_PROGRESS.
  assert.equal((await startWork(auth, a.issueId)).status, "IN_PROGRESS");

  // 7. Upload the after-photo → RESOLVED.
  const resolved = await resolveIssue(auth, a.issueId, "[integration test] judge demo: pothole filled");
  assert.equal(resolved.status, "RESOLVED");

  // 8. Citizen A's My Reports shows RESOLVED with the evidence (and so does B's).
  for (const who of [a.citizen, b]) {
    const mine = await getMyReports(who);
    assert.equal(mine.length, 1);
    const issue = mine[0]!.issue;
    assert.equal(issue.id, a.issueId);
    assert.equal(issue.status, "RESOLVED");
    assert.equal(issue.final_priority, "HIGH");
    assert.equal(issue.report_count, 2);
    assert.equal(issue.latest_resolution_evidence?.id, resolved.evidence.id);
    assert.equal(issue.latest_resolution_evidence?.image_url, photoRoutePath("evidence", resolved.evidence.id));
    await expectPhoto(issue.latest_resolution_evidence!.image_url!, { token: who.accessToken });
  }

  const detail = await getIssue(a.issueId);
  assert.equal(detail.status, "RESOLVED");
  expectTimeline(
    detail.timeline,
    [["CREATED"], ["SUPPORT_ADDED"], ["PRIORITY_SET"], ["ASSIGNED"], ["STATUS_CHANGED"], ["RESOLVED"]],
    ["CITIZEN", "CITIZEN", "AUTHORITY", "AUTHORITY", "AUTHORITY", "AUTHORITY"],
  );
});

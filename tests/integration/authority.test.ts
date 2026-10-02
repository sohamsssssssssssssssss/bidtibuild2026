/**
 * Phase 2 — the authority workflow through the API (02 §4, §5.1, §7.2, §8, §10.3, §13; phase-2
 * contract): access control on every authority route, departments, priority/severity, assign and
 * reassign (SLA), start work, resolve with evidence, the disallowed transitions, rejection
 * (moderation) and the queue (v1).
 *
 * Every test except the access-control one acts as the authority account `npm run demo:reset`
 * creates (AUTHORITY_EMAIL / AUTHORITY_PASSWORD); without those variables they are skipped.
 * Rows created here stay until the next `demo:reset` (issue_events is append-only).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { LEVELS, PRIORITY_CONFIG, SLA_DEFAULT_HOURS, type Level } from "../../src/config/civic.ts";
import { authorityQueueResponseSchema, type AuthorityQueueRow } from "../../src/contracts/authority.ts";
import { departmentsResponseSchema } from "../../src/contracts/departments.ts";
import {
  issueDetailResponseSchema,
  issuesResponseSchema,
  resolveIssueResponseSchema,
  setPriorityResponseSchema,
  transitionIssueResponseSchema,
} from "../../src/contracts/issues.ts";
import {
  adminClient,
  api,
  assignIssue,
  authority,
  authorityTestOptions,
  bboxAround,
  expectError,
  expectOk,
  expectPhoto,
  expectTimeline,
  fetchPhoto,
  getIssue,
  getMyReports,
  jsonStrings,
  newCitizen,
  newIssue,
  photoPath,
  photoRoutePath,
  PRIVATE_KEYS,
  ROADS,
  SEED_DEPARTMENTS,
  startWork,
  testOptions,
  uploadResolutionPhoto,
  VIEWER_ONLY_PHOTO_CACHE,
  type Authority,
} from "./helpers.ts";

const HOUR_MS = 3_600_000;

/** Two ISO timestamps (possibly formatted differently by different SQL functions) are the same instant. */
function sameInstant(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && Date.parse(a) === Date.parse(b);
}
const STORM_WATER = SEED_DEPARTMENTS.find((d) => d.name === "Storm Water Drainage")!;

function setPriority(auth: Authority, issueId: string, body: unknown) {
  return api("PATCH", `/api/issues/${issueId}/priority`, { token: auth.accessToken, body });
}

function patchStatus(auth: Authority, issueId: string, body: unknown) {
  return api("PATCH", `/api/issues/${issueId}/status`, { token: auth.accessToken, body });
}

async function getQueue(auth: Authority, query = ""): Promise<AuthorityQueueRow[]> {
  return expectOk(await api("GET", `/api/authority/queue${query}`, { token: auth.accessToken }), authorityQueueResponseSchema);
}

// ---------------------------------------------------------------------------
// Queue v1 (Phase 2). Phase 4 fills factors / score / label / recurrence_count and sorts by score
// descending: update ONLY these two helpers then.
// ---------------------------------------------------------------------------

/** v1: the recommendation fields are present but null. */
function expectQueueRecommendation(row: AuthorityQueueRow): void {
  assert.equal(row.factors, null, `queue v1: factors must be null (${row.id})`);
  assert.equal(row.score, null, `queue v1: score must be null (${row.id})`);
  assert.equal(row.label, null, `queue v1: label must be null (${row.id})`);
  assert.equal(row.recurrence_count, null, `queue v1: recurrence_count must be null (${row.id})`);
}

/** v1 order: final priority CRITICAL, HIGH, MEDIUM, LOW, then none; then oldest first. */
function expectQueueOrder(rows: readonly AuthorityQueueRow[]): void {
  const rank = (p: Level | null) => (p === null ? LEVELS.length : LEVELS.length - 1 - LEVELS.indexOf(p));
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    const ok =
      rank(a.final_priority) < rank(b.final_priority) ||
      (rank(a.final_priority) === rank(b.final_priority) && Date.parse(a.created_at) <= Date.parse(b.created_at));
    assert.ok(
      ok,
      `queue out of order at ${i}: ${a.final_priority}/${a.created_at} before ${b.final_priority}/${b.created_at}`,
    );
  }
}

// ---------------------------------------------------------------------------

test("authority routes: no session → 401, a citizen (even the reporter) → 403, nothing changes", testOptions(), async () => {
  const { citizen, issueId } = await newIssue();
  const routes: { method: string; path: string; body?: unknown }[] = [
    { method: "GET", path: "/api/departments" },
    { method: "GET", path: "/api/authority/queue" },
    { method: "PATCH", path: `/api/issues/${issueId}/priority`, body: { final_priority: "CRITICAL" } },
    { method: "POST", path: `/api/issues/${issueId}/assign`, body: { department_id: ROADS.id } },
    { method: "PATCH", path: `/api/issues/${issueId}/status`, body: { to_status: "REJECTED", note: "nope" } },
    { method: "POST", path: `/api/issues/${issueId}/resolution`, body: { image_path: photoPath(citizen.userId) } },
  ];
  for (const r of routes) {
    expectError(await api(r.method, r.path, { body: r.body }), 401, "UNAUTHENTICATED");
    expectError(await api(r.method, r.path, { body: r.body, token: "not-a-real-token" }), 401, "UNAUTHENTICATED");
    expectError(await api(r.method, r.path, { body: r.body, token: citizen.accessToken }), 403, "FORBIDDEN");
  }

  const detail = await getIssue(issueId);
  assert.equal(detail.status, "REPORTED");
  assert.equal(detail.final_priority, null);
  assert.equal(detail.department, null);
  expectTimeline(detail.timeline, [["CREATED"]]);
});

test("departments: the seed's five active departments, by name", authorityTestOptions(), async () => {
  const auth = await authority();
  const departments = expectOk(await api("GET", "/api/departments", { token: auth.accessToken }), departmentsResponseSchema);
  assert.deepEqual(
    departments.map((d) => ({ ...d, default_categories: [...d.default_categories].sort() })),
    SEED_DEPARTMENTS.map((d) => ({ ...d, default_categories: [...d.default_categories].sort() })),
  );
  // 02 §8: every department is seeded with the default SLA.
  for (const d of departments) assert.equal(d.sla_hours, SLA_DEFAULT_HOURS, d.name);
});

test(
  "workflow: priority + severity, assign (SLA), reassign, start, resolve with evidence — timeline and My Reports",
  authorityTestOptions(),
  async () => {
    const auth = await authority();
    const { citizen, issueId, reportId } = await newIssue();

    // --- PATCH priority: both fields; events only on change ---------------------------------------
    expectError(await setPriority(auth, issueId, {}), 400, "VALIDATION_FAILED");
    expectError(await setPriority(auth, issueId, { final_priority: "URGENT" }), 400, "VALIDATION_FAILED");
    const body = { final_priority: "HIGH", authority_severity: "MEDIUM" } as const;
    const set = expectOk(await setPriority(auth, issueId, body), setPriorityResponseSchema);
    assert.equal(set.issue_id, issueId);
    assert.equal(set.status, "REPORTED");
    assert.equal(set.final_priority, "HIGH");
    assert.equal(set.authority_severity, "MEDIUM");
    // The identical PATCH again: still 200, same values, and (checked below) no new events.
    const again = expectOk(await setPriority(auth, issueId, body), setPriorityResponseSchema);
    assert.equal(again.final_priority, "HIGH");
    assert.equal(again.authority_severity, "MEDIUM");
    let detail = await getIssue(issueId);
    assert.equal(detail.final_priority, "HIGH");
    assert.equal(detail.authority_severity, "MEDIUM");
    expectTimeline(detail.timeline, [["CREATED"], ["PRIORITY_SET", "SEVERITY_CONFIRMED"]]);

    // --- Assign (REPORTED → ASSIGNED): sla_due_at = assigned_at + the department's sla_hours --------
    expectError(
      await api("POST", `/api/issues/${issueId}/assign`, { token: auth.accessToken, body: { department_id: randomUUID() } }),
      400,
      "VALIDATION_FAILED",
    );
    const assigned = await assignIssue(auth, issueId, ROADS.id);
    assert.equal(assigned.issue_id, issueId);
    assert.equal(assigned.status, "ASSIGNED");
    assert.equal(assigned.event_type, "ASSIGNED");
    assert.deepEqual(assigned.department, { id: ROADS.id, name: ROADS.name });
    assert.equal(Date.parse(assigned.sla_due_at) - Date.parse(assigned.assigned_at), ROADS.sla_hours * HOUR_MS);

    // Same department again → CONFLICT; status unchanged.
    expectError(
      await api("POST", `/api/issues/${issueId}/assign`, { token: auth.accessToken, body: { department_id: ROADS.id } }),
      409,
      "CONFLICT",
    );

    // --- Reassign to another department (ASSIGNED → ASSIGNED, REASSIGNED), new SLA -----------------
    const reassigned = await assignIssue(auth, issueId, STORM_WATER.id);
    assert.equal(reassigned.status, "ASSIGNED");
    assert.equal(reassigned.event_type, "REASSIGNED");
    assert.deepEqual(reassigned.department, { id: STORM_WATER.id, name: STORM_WATER.name });
    assert.ok(Date.parse(reassigned.assigned_at) >= Date.parse(assigned.assigned_at));
    assert.equal(Date.parse(reassigned.sla_due_at) - Date.parse(reassigned.assigned_at), STORM_WATER.sla_hours * HOUR_MS);

    // --- Start work (ASSIGNED → IN_PROGRESS) -------------------------------------------------------
    const started = await startWork(auth, issueId);
    assert.equal(started.issue_id, issueId);
    assert.equal(started.status, "IN_PROGRESS");
    assert.equal(started.from_status, "ASSIGNED");
    detail = await getIssue(issueId);
    assert.equal(detail.status, "IN_PROGRESS");
    assert.deepEqual(detail.department, { id: STORM_WATER.id, name: STORM_WATER.name });
    assert.equal(sameInstant(detail.assigned_at, reassigned.assigned_at), true, "detail assigned_at");
    assert.equal(sameInstant(detail.sla_due_at, reassigned.sla_due_at), true, "detail sla_due_at");

    // --- Resolve (IN_PROGRESS → RESOLVED) with evidence -------------------------------------------
    // A path outside the authority's own folder → 403 before SQL; a never-uploaded one → 400.
    expectError(
      await api("POST", `/api/issues/${issueId}/resolution`, {
        token: auth.accessToken,
        body: { image_path: photoPath(citizen.userId) },
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await api("POST", `/api/issues/${issueId}/resolution`, {
        token: auth.accessToken,
        body: { image_path: photoPath(auth.userId) },
      }),
      400,
      "VALIDATION_FAILED",
    );
    const note = `[integration test] pothole filled ${randomUUID().slice(0, 8)}`;
    const resolvedRes = await api("POST", `/api/issues/${issueId}/resolution`, {
      token: auth.accessToken,
      body: { image_path: await uploadResolutionPhoto(auth), note: `  ${note}  ` },
    });
    const resolved = expectOk(resolvedRes, resolveIssueResponseSchema);
    assert.equal(resolved.issue_id, issueId);
    assert.equal(resolved.status, "RESOLVED");
    assert.equal(resolved.evidence.note, note);
    const evidenceUrl = photoRoutePath("evidence", resolved.evidence.id);
    assert.equal(resolved.evidence.image_url, evidenceUrl);
    await expectPhoto(evidenceUrl);

    // --- Closed now: no more priority changes or transitions --------------------------------------
    expectError(await setPriority(auth, issueId, { final_priority: "LOW" }), 409, "CONFLICT");
    expectError(await patchStatus(auth, issueId, { to_status: "IN_PROGRESS" }), 409, "INVALID_TRANSITION");
    expectError(
      await api("POST", `/api/issues/${issueId}/assign`, { token: auth.accessToken, body: { department_id: ROADS.id } }),
      409,
      "INVALID_TRANSITION",
    );

    // --- Public detail: status, evidence, sanitised timeline in order with actor kinds -------------
    const detailRes = await api("GET", `/api/issues/${issueId}`, { ip: null });
    detail = expectOk(detailRes, issueDetailResponseSchema);
    assert.equal(detail.status, "RESOLVED");
    assert.equal(sameInstant(detail.resolved_at, resolved.resolved_at), true, "detail resolved_at");
    assert.equal(detail.final_priority, "HIGH");
    assert.deepEqual(
      detail.resolution_evidence.map((e) => ({ id: e.id, image_url: e.image_url, note: e.note })),
      [{ id: resolved.evidence.id, image_url: evidenceUrl, note }],
    );
    expectTimeline(
      detail.timeline,
      [["CREATED"], ["PRIORITY_SET", "SEVERITY_CONFIRMED"], ["ASSIGNED"], ["REASSIGNED"], ["STATUS_CHANGED"], ["RESOLVED"]],
      ["CITIZEN", "AUTHORITY", "AUTHORITY", "AUTHORITY", "AUTHORITY", "AUTHORITY"],
    );
    const byType = (t: string) => detail.timeline.find((e) => e.event_type === t)!;
    assert.deepEqual([byType("ASSIGNED").from_status, byType("ASSIGNED").to_status], ["REPORTED", "ASSIGNED"]);
    assert.deepEqual([byType("STATUS_CHANGED").from_status, byType("STATUS_CHANGED").to_status], ["ASSIGNED", "IN_PROGRESS"]);
    assert.deepEqual([byType("RESOLVED").from_status, byType("RESOLVED").to_status], ["IN_PROGRESS", "RESOLVED"]);
    // No actor ids (authority or citizen), uploader paths or private keys anywhere.
    for (const s of jsonStrings(detailRes.json)) {
      assert.ok(!s.includes(auth.userId), `issue detail leaks the authority uid in ${JSON.stringify(s)}`);
      assert.ok(!s.includes(citizen.userId), `issue detail leaks the reporter uid in ${JSON.stringify(s)}`);
      assert.ok(!(PRIVATE_KEYS as readonly string[]).includes(s), `issue detail exposes key ${s}`);
    }

    // --- The citizen's My Reports: RESOLVED with the evidence --------------------------------------
    const mine = await getMyReports(citizen);
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.id, reportId);
    const summary = mine[0]!.issue;
    assert.equal(summary.id, issueId);
    assert.equal(summary.status, "RESOLVED");
    assert.equal(summary.final_priority, "HIGH");
    assert.equal(sameInstant(summary.resolved_at, resolved.resolved_at), true, "my-reports resolved_at");
    assert.equal(summary.latest_resolution_evidence?.id, resolved.evidence.id);
    assert.equal(summary.latest_resolution_evidence?.image_url, evidenceUrl);
    assert.equal(summary.latest_resolution_evidence?.note, note);
    await expectPhoto(evidenceUrl, { token: citizen.accessToken });

    // --- Resolved issues leave the default queue ---------------------------------------------------
    assert.ok(!(await getQueue(auth)).some((r) => r.id === issueId), "a RESOLVED issue is still in the default queue");
  },
);

test(
  "disallowed: start or resolve a REPORTED issue → 409, bad targets → 400, REOPENED → 501, unknown issue → 404",
  authorityTestOptions(),
  async () => {
    const auth = await authority();
    const { issueId } = await newIssue();

    const start = expectError(await patchStatus(auth, issueId, { to_status: "IN_PROGRESS" }), 409, "INVALID_TRANSITION");
    assert.ok(!/PT409|sqlstate|->/i.test(start), `DB details must not leak: ${start}`);
    expectError(
      await api("POST", `/api/issues/${issueId}/resolution`, {
        token: auth.accessToken,
        body: { image_path: await uploadResolutionPhoto(auth) },
      }),
      409,
      "INVALID_TRANSITION",
    );
    // Targets the status route does not take (RESOLVED has its own route; ASSIGNED is assign).
    for (const to_status of ["RESOLVED", "ASSIGNED", "MERGED", "DONE"]) {
      expectError(await patchStatus(auth, issueId, { to_status }), 400, "VALIDATION_FAILED");
    }
    // Reopen is a stretch feature behind FEATURES.reopen.
    expectError(await patchStatus(auth, issueId, { to_status: "REOPENED", note: "still broken" }), 501, "NOT_IMPLEMENTED");

    // Unknown issue / malformed id.
    const missing = randomUUID();
    expectError(await patchStatus(auth, missing, { to_status: "IN_PROGRESS" }), 404, "NOT_FOUND");
    expectError(await setPriority(auth, missing, { final_priority: "LOW" }), 404, "NOT_FOUND");
    expectError(
      await api("POST", `/api/issues/${missing}/assign`, { token: auth.accessToken, body: { department_id: ROADS.id } }),
      404,
      "NOT_FOUND",
    );
    expectError(await patchStatus(auth, "not-a-uuid", { to_status: "IN_PROGRESS" }), 400, "VALIDATION_FAILED");

    const detail = await getIssue(issueId);
    assert.equal(detail.status, "REPORTED");
    expectTimeline(detail.timeline, [["CREATED"]]);
  },
);

test(
  "reject: note required; then hidden from the public map and detail, still visible to its reporter",
  authorityTestOptions(),
  async () => {
    const auth = await authority();
    const { citizen, issueId, reportId, point } = await newIssue();
    const stranger = await newCitizen();

    expectError(await patchStatus(auth, issueId, { to_status: "REJECTED" }), 400, "VALIDATION_FAILED");
    expectError(await patchStatus(auth, issueId, { to_status: "REJECTED", note: "   " }), 400, "VALIDATION_FAILED");
    assert.equal((await getIssue(issueId)).status, "REPORTED");

    const note = `[integration test] not a civic issue ${randomUUID().slice(0, 8)}`;
    const rejected = expectOk(await patchStatus(auth, issueId, { to_status: "REJECTED", note }), transitionIssueResponseSchema);
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.from_status, "REPORTED");

    // Public: gone from the map, detail 404 for anon and for an unrelated citizen.
    const markers = expectOk(await api("GET", `/api/issues?bbox=${bboxAround(point)}`, { ip: null }), issuesResponseSchema);
    assert.ok(!markers.some((m) => m.id === issueId), "a REJECTED issue is still on the public map");
    expectError(await api("GET", `/api/issues/${issueId}`, { ip: null }), 404, "NOT_FOUND");
    expectError(await api("GET", `/api/issues/${issueId}`, { token: stranger.accessToken }), 404, "NOT_FOUND");

    // The photo: 404 for anon / strangers; the reporter and the authority get it, never cached publicly.
    const photoUrl = photoRoutePath("report", reportId);
    assert.equal((await fetchPhoto(photoUrl)).status, 404);
    assert.equal((await fetchPhoto(photoUrl, { token: stranger.accessToken })).status, 404);
    await expectPhoto(photoUrl, { token: citizen.accessToken, cacheControl: VIEWER_ONLY_PHOTO_CACHE });
    await expectPhoto(photoUrl, { token: auth.accessToken, cacheControl: VIEWER_ONLY_PHOTO_CACHE });

    // The reporter (and the authority) still see the detail, with the reason in the timeline.
    for (const token of [citizen.accessToken, auth.accessToken]) {
      const detail = await getIssue(issueId, { token });
      assert.equal(detail.status, "REJECTED");
      expectTimeline(detail.timeline, [["CREATED"], ["REJECTED"]], ["CITIZEN", "AUTHORITY"]);
      const event = detail.timeline[1]!;
      assert.deepEqual([event.from_status, event.to_status, event.note], ["REPORTED", "REJECTED", note]);
    }
    const mine = await getMyReports(citizen);
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.issue.status, "REJECTED");
    assert.equal(mine[0]!.image_url, photoUrl);

    // Closed: no further transitions, and it leaves the queue.
    expectError(await patchStatus(auth, issueId, { to_status: "IN_PROGRESS" }), 409, "INVALID_TRANSITION");
    expectError(
      await api("POST", `/api/issues/${issueId}/assign`, { token: auth.accessToken, body: { department_id: ROADS.id } }),
      409,
      "INVALID_TRANSITION",
    );
    assert.ok(!(await getQueue(auth)).some((r) => r.id === issueId), "a REJECTED issue is still in the queue");
  },
);

test("queue: open issues only, filters, v1 order (final priority, then oldest)", authorityTestOptions(), async () => {
  const auth = await authority();
  const { issueId } = await newIssue({ body: { citizen_severity: "LOW" } });

  // --- Default: every open status, never RESOLVED / REJECTED / MERGED ------------------------------
  const all = await getQueue(auth);
  for (const row of all) {
    assert.ok((PRIORITY_CONFIG.queue_statuses as readonly string[]).includes(row.status), `queue has a ${row.status} issue`);
    expectQueueRecommendation(row);
  }
  expectQueueOrder(all);
  const { data: closed, error } = await adminClient()
    .from("issues")
    .select("id")
    .in("status", ["RESOLVED", "REJECTED", "MERGED"])
    .limit(20);
  assert.equal(error, null);
  assert.ok((closed ?? []).length > 0, "precondition: the seed has closed issues");
  for (const c of closed as { id: string }[]) assert.ok(!all.some((r) => r.id === c.id), `closed issue ${c.id} in the queue`);

  // --- The fresh issue's row -------------------------------------------------------------------------
  let row = all.find((r) => r.id === issueId);
  assert.ok(row, "the new issue is missing from the queue");
  assert.equal(row.status, "REPORTED");
  assert.equal(row.category, "OTHER");
  assert.equal(row.final_priority, null);
  assert.equal(row.effective_severity, "LOW");
  assert.equal(row.severity_source, "CITIZEN");
  assert.equal(row.report_count, 1);
  assert.equal(row.distinct_reporter_count, 1);
  assert.equal(row.department, null);
  assert.equal(row.sla_due_at, null);
  assert.equal(row.is_seed, false);

  // --- Filters ---------------------------------------------------------------------------------------
  const has = (rows: AuthorityQueueRow[]) => rows.some((r) => r.id === issueId);
  const reported = await getQueue(auth, "?status=REPORTED");
  assert.ok(has(reported) && reported.every((r) => r.status === "REPORTED"));
  const assignedOnly = await getQueue(auth, "?status=ASSIGNED");
  assert.ok(!has(assignedOnly) && assignedOnly.every((r) => r.status === "ASSIGNED"));
  assert.ok(has(await getQueue(auth, "?status=ASSIGNED,REPORTED")));
  const other = await getQueue(auth, "?category=OTHER");
  assert.ok(has(other) && other.every((r) => r.category === "OTHER"));
  assert.ok(!has(await getQueue(auth, "?category=POTHOLE&category=GARBAGE")));
  let unassigned = await getQueue(auth, "?department_id=unassigned");
  assert.ok(has(unassigned) && unassigned.every((r) => r.department === null));
  expectQueueOrder(unassigned);
  expectError(await api("GET", "/api/authority/queue?status=RESOLVED", { token: auth.accessToken }), 400, "VALIDATION_FAILED");
  expectError(await api("GET", "/api/authority/queue?department_id=roads", { token: auth.accessToken }), 400, "VALIDATION_FAILED");

  // --- After assigning to Roads + CRITICAL priority + authority severity ----------------------------
  await assignIssue(auth, issueId, ROADS.id);
  expectOk(
    await setPriority(auth, issueId, { final_priority: "CRITICAL", authority_severity: "HIGH" }),
    setPriorityResponseSchema,
  );
  const roads = await getQueue(auth, `?department_id=${ROADS.id}`);
  row = roads.find((r) => r.id === issueId);
  assert.ok(row, "the issue is missing from its department's queue");
  assert.ok(roads.every((r) => r.department?.id === ROADS.id));
  assert.equal(row.status, "ASSIGNED");
  assert.deepEqual(row.department, { id: ROADS.id, name: ROADS.name });
  assert.ok(row.sla_due_at !== null);
  assert.equal(row.final_priority, "CRITICAL");
  assert.equal(row.effective_severity, "HIGH");
  assert.equal(row.severity_source, "AUTHORITY");
  unassigned = await getQueue(auth, "?department_id=unassigned");
  assert.ok(!has(unassigned));

  // Ordering with the issue now CRITICAL: it sits among the CRITICAL rows, ahead of everything else.
  const after = await getQueue(auth);
  expectQueueOrder(after);
  const at = after.findIndex((r) => r.id === issueId);
  assert.ok(at >= 0 && after.slice(0, at).every((r) => r.final_priority === "CRITICAL"));
});

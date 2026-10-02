/**
 * Phase 5 — City Pulse through the API (02 §6, §14; 03 §3 and §6 step 9; 06 rules 3 and 7;
 * phase-5 contract): the seeded CRITICAL DRAINAGE hotspot, authority regeneration, the `after()`
 * trigger on new issues, supporting reports that neither regenerate nor count, and a REJECTED
 * member that is hidden and then breaks its cluster.
 *
 * Test 1 reads the hotspot `npm run demo:reset` computed. The seed's current window only holds all
 * six DRAINAGE issues for ~15 minutes after the reset (the oldest is created 105 min before it and
 * the current window is 2 h), and every new issue — from any test file — regenerates City Pulse.
 * So test 1 checks the seeded issues' ages against the active set's generated_at and SKIPS
 * ("aged out — run npm run demo:reset -- --local") instead of failing when they no longer fit.
 *
 * Test 2 is one test with ordered subtests (shared state, authority account required). Rows created
 * here stay until the next `demo:reset` (issue_events is append-only).
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { CITY_PULSE_CONFIG, CITY_PULSE_DEMO_CENTER, DEMO_SPOT, OPEN_STATUSES } from "../../src/config/civic.ts";
import type { Hotspot } from "../../src/contracts/hotspots.ts";
import { issuesResponseSchema, transitionIssueResponseSchema } from "../../src/contracts/issues.ts";
import { supportReportResponseSchema } from "../../src/contracts/reports.ts";
import {
  adminClient,
  api,
  authority,
  authorityTestOptions,
  bboxAround,
  cityPulseExplanations,
  distanceM,
  expectError,
  expectHotspotSet,
  expectOk,
  getHotspots,
  newCitizen,
  newIssue,
  offsetPoint,
  polygonContains,
  polygonDistanceM,
  pollUntil,
  randomMumbaiPoint,
  regenerateHotspots,
  reportBody,
  testOptions,
  uploadPhoto,
  type Authority,
  type FreshIssue,
  type LatLng,
} from "./helpers.ts";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** supabase/seed.sql 4b: 101–106 in the current window (last 2 h), 107 in the baseline window. */
const seededId = (n: number) => `5eed1000-0000-4000-8000-000000000${n}`;
const SEEDED_CURRENT_IDS = [101, 102, 103, 104, 105, 106].map(seededId);
const SEEDED_BASELINE_ID = seededId(107);
const SEEDED_IDS = [...SEEDED_CURRENT_IDS, SEEDED_BASELINE_ID];

/** Keep clear of the window edges by this much (timestamps here are ms, Postgres µs). */
const EDGE_MARGIN_MS = 5_000;

const AGED_OUT = "seeded City Pulse scenario has aged out — run npm run demo:reset -- --local";

/** The seeded scenario's issues (service role): status and created_at, or why they can't be used. */
async function seededIssues(): Promise<Map<string, { status: string; created_at: string }> | string> {
  const { data, error } = await adminClient().from("issues").select("id, status, created_at").in("id", SEEDED_IDS);
  if (error) throw new Error(`issues lookup failed: ${error.message}`);
  const rows = new Map((data as { id: string; status: string; created_at: string }[]).map((r) => [r.id, r]));
  const missing = SEEDED_IDS.filter((id) => !rows.has(id));
  if (missing.length > 0) return `seeded City Pulse issues missing (${missing.join(", ")}) — run npm run demo:reset -- --local`;
  const closed = [...rows.values()].filter((r) => !(OPEN_STATUSES as readonly string[]).includes(r.status));
  if (closed.length > 0) {
    return `seeded City Pulse issues no longer open (${closed.map((r) => `${r.id} ${r.status}`).join(", ")}) — run npm run demo:reset -- --local`;
  }
  return rows;
}

/**
 * Whether the seeded issues still form "6 current + 1 baseline" at City Pulse time `at` (ms):
 * 101–106 inside the current window, 107 inside the baseline window. Returns why not, or false.
 */
function seededWindowProblem(rows: Map<string, { created_at: string }>, at: number): string | false {
  const c = CITY_PULSE_CONFIG;
  const currentStart = at - c.current_window_hours * HOUR_MS;
  const inputStart = at - c.input_window_hours * HOUR_MS;
  const created = (id: string) => Date.parse(rows.get(id)!.created_at);
  const oldestCurrent = Math.min(...SEEDED_CURRENT_IDS.map(created));
  const baseline = created(SEEDED_BASELINE_ID);
  const when = new Date(at).toISOString();
  if (oldestCurrent <= currentStart + EDGE_MARGIN_MS) {
    const age = ((at - oldestCurrent) / MINUTE_MS).toFixed(1);
    return `${AGED_OUT} (at City Pulse time ${when} the oldest current-window issue was ${age} min old; it must be < ${c.current_window_hours * 60})`;
  }
  if (baseline <= inputStart + EDGE_MARGIN_MS || baseline >= currentStart - EDGE_MARGIN_MS) {
    return `${AGED_OUT} (at City Pulse time ${when} the baseline issue ${SEEDED_BASELINE_ID} is outside the baseline window)`;
  }
  return false;
}

/** Public map markers (open + RESOLVED) around a point, for issue locations. */
async function markersAround(p: LatLng, d: number, category: string) {
  return expectOk(await api("GET", `/api/issues?bbox=${bboxAround(p, d)}&category=${category}`, { ip: null }), issuesResponseSchema);
}

/** Every hotspot stays well away from DEMO_SPOT (02 §14: the judge demo spot stays clean). */
function expectNothingNearDemoSpot(list: readonly Hotspot[]): void {
  for (const h of list) {
    assert.ok(!polygonContains(h.geometry, DEMO_SPOT), `hotspot ${h.id} (${h.category}) covers DEMO_SPOT`);
    const d = polygonDistanceM(h.geometry, DEMO_SPOT);
    assert.ok(d > 500, `hotspot ${h.id} (${h.category}) is ${d.toFixed(0)} m from DEMO_SPOT`);
  }
}

// ---------------------------------------------------------------------------
// 1. The seeded scenario (02 §14, 03 §6 step 9)
// ---------------------------------------------------------------------------

test(
  "seeded scenario: GET /api/hotspots (public) shows the CRITICAL DRAINAGE hotspot — 6 current, 1 baseline, expected 0.33 — and nothing near DEMO_SPOT",
  testOptions(),
  async (t) => {
    const rows = await seededIssues();
    if (typeof rows === "string") return t.skip(rows);

    const list = await getHotspots();
    const generatedAt = expectHotspotSet(list);
    const drainage = list.find((h) => h.member_issue_ids.some((id) => SEEDED_IDS.includes(id)));
    // Judge the seed against the City Pulse run that produced this set (any new issue, from any
    // test file, regenerates it), or against now when there is no active hotspot at all.
    const problem = seededWindowProblem(rows, generatedAt ? Date.parse(generatedAt) : Date.now());
    if (problem) return t.skip(problem);

    assert.ok(drainage, `no hotspot contains the seeded City Pulse issues: ${JSON.stringify(list.map((h) => [h.category, h.member_issue_ids]))}`);
    assert.equal(drainage.category, "DRAINAGE");
    assert.equal(drainage.severity, "CRITICAL");
    for (const id of SEEDED_IDS) assert.ok(drainage.member_issue_ids.includes(id), `member_issue_ids lack ${id}`);
    // Members are ordered by created_at (phase-5 contract): 107 (baseline) first, then 101 … 106.
    const seededOrder = drainage.member_issue_ids.filter((id) => SEEDED_IDS.includes(id));
    assert.deepEqual(seededOrder, [SEEDED_BASELINE_ID, ...SEEDED_CURRENT_IDS], "member_issue_ids not ordered by created_at");
    assert.equal(drainage.current_issue_count, 6);
    assert.equal(drainage.baseline_issue_count, 1);
    assert.equal(drainage.expected_current_count, 0.33);
    assert.equal(drainage.trend_percent, 566.7);
    assert.ok(
      drainage.explanation.startsWith("6 DRAINAGE issues within ~300 m in the last 2 h"),
      `explanation: ${drainage.explanation}`,
    );
    assert.deepEqual(cityPulseExplanations("DRAINAGE", 6, 1), ["6 DRAINAGE issues within ~300 m in the last 2 h (expected 0.3) — trend +566%."]);
    assert.equal(drainage.explanation, "6 DRAINAGE issues within ~300 m in the last 2 h (expected 0.3) — trend +566%.");

    // The shape covers the scenario: its centre and every seeded issue (public map locations).
    assert.equal(drainage.geometry.type, "Polygon");
    assert.ok(polygonContains(drainage.geometry, CITY_PULSE_DEMO_CENTER), "the hotspot does not cover CITY_PULSE_DEMO_CENTER");
    const markers = await markersAround(CITY_PULSE_DEMO_CENTER, 0.004, "DRAINAGE");
    for (const id of SEEDED_IDS) {
      const m = markers.find((x) => x.id === id);
      assert.ok(m, `seeded issue ${id} is not on the public map`);
      assert.ok(m.is_seed, `${id} must be is_seed`);
      assert.ok(polygonContains(drainage.geometry, m), `the hotspot does not cover seeded issue ${id} at ${m.lat},${m.lng}`);
    }
    // Seeded points lie within ~110 m of the centre, plus the 50 m buffer: the shape stays local.
    const farthest = Math.max(...(drainage.geometry.coordinates[0] ?? []).map(([lng, lat]) => distanceM({ lat, lng }, CITY_PULSE_DEMO_CENTER)));
    assert.ok(farthest < 400, `the hotspot shape reaches ${farthest.toFixed(0)} m from CITY_PULSE_DEMO_CENTER`);

    expectNothingNearDemoSpot(list);
  },
);

// ---------------------------------------------------------------------------
// 2. The engine: regenerate, after(), supporting reports, rejection
// ---------------------------------------------------------------------------

/** A spot with no GARBAGE issue on the public map within ~900 m (randomMumbaiPoint: ≥ 2 km from DEMO_SPOT and the scenario). */
async function quietGarbageSpot(): Promise<LatLng> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const p = randomMumbaiPoint();
    if ((await markersAround(p, 0.008, "GARBAGE")).length === 0) return p;
  }
  throw new Error("no spot without GARBAGE issues nearby after 10 tries");
}

function garbageHotspotOf(list: readonly Hotspot[], ids: readonly string[]): Hotspot | undefined {
  return list.find((h) => h.member_issue_ids.some((id) => ids.includes(id)));
}

/**
 * Waits until the active set's generated_at holds still for `quietMs` (pending after() runs from
 * our own reports have landed), then returns it.
 */
async function settledGeneratedAt(quietMs = 2_000, timeoutMs = 15_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let last = expectHotspotSet(await getHotspots());
  for (;;) {
    await sleep(quietMs);
    const next = expectHotspotSet(await getHotspots());
    if (next === last || Date.now() >= deadline) return next;
    last = next;
  }
}

test("City Pulse engine: regenerate, after() on new issues, supporting reports, rejection", authorityTestOptions({ timeout: 240_000 }), async (t) => {
  let auth: Authority | undefined;
  const garbage: FreshIssue[] = [];
  let points: LatLng[] = [];

  await t.test("regenerate: no session → 401, citizen → 403; authority → 200 with a new generation", async () => {
    expectError(await api("POST", "/api/hotspots/regenerate", {}), 401, "UNAUTHENTICATED");
    const citizen = await newCitizen();
    expectError(await api("POST", "/api/hotspots/regenerate", { token: citizen.accessToken }), 403, "FORBIDDEN");
    auth = await authority();

    const before = await getHotspots();
    const beforeAt = expectHotspotSet(before);
    const regen = await regenerateHotspots(auth);
    const regenAt = expectHotspotSet(regen.hotspots);
    if (regenAt) assert.equal(Date.parse(regenAt), Date.parse(regen.generated_at), "hotspots carry the run's generated_at");
    if (beforeAt) {
      assert.ok(Date.parse(regen.generated_at) > Date.parse(beforeAt), `generated_at ${regen.generated_at} not after ${beforeAt}`);
    }
    // New rows every run (old ones stay as inactive history): no id survives.
    const beforeIds = new Set(before.map((h) => h.id));
    for (const h of regen.hotspots) assert.ok(!beforeIds.has(h.id), `hotspot id ${h.id} reused by regenerate`);
    expectNothingNearDemoSpot(regen.hotspots);

    // GET now serves this generation — or a newer one, if another test file's new issue
    // regenerated meanwhile (after(), 02 §6.8). Either way: one generated_at.
    const after = await getHotspots();
    const afterAt = expectHotspotSet(after);
    if (afterAt === null || Date.parse(afterAt) === Date.parse(regen.generated_at)) {
      assert.deepEqual(after.map((h) => h.id).sort(), regen.hotspots.map((h) => h.id).sort(), "GET does not return the regenerated set");
    } else {
      assert.ok(Date.parse(afterAt) > Date.parse(regen.generated_at), `GET serves an older generation ${afterAt}`);
    }
  });

  await t.test("after(): four citizens' GARBAGE reports within ~100 m become a HIGH hotspot (4 current, trend +400) without a regenerate call", async () => {
    assert.ok(auth, "depends on the regenerate subtest");
    const base = await quietGarbageSpot();
    points = [
      base,
      offsetPoint(base.lat, base.lng, 0, 70),
      offsetPoint(base.lat, base.lng, 70, 0),
      offsetPoint(base.lat, base.lng, 60, 60),
    ];
    for (const p of points) {
      assert.ok(distanceM(p, DEMO_SPOT) > 2000 && distanceM(p, CITY_PULSE_DEMO_CENTER) > 2000, "spot too close to the demo areas");
    }
    // Four different citizens (5 reports/hour each); sequential, so created_at follows this order.
    for (const p of points) {
      garbage.push(await newIssue({ body: { category: "GARBAGE", lat: p.lat, lng: p.lng } }));
    }
    const ids = garbage.map((g) => g.issueId);

    const hotspot = await pollUntil(async () => {
      const h = garbageHotspotOf(await getHotspots(), ids);
      return h && ids.every((id) => h.member_issue_ids.includes(id)) ? h : undefined;
    }, 15_000);
    assert.ok(hotspot, "no hotspot with the four new GARBAGE issues within 15 s — is after() regenerating City Pulse on new issues (02 §6.8)?");
    assert.equal(hotspot.category, "GARBAGE");
    assert.deepEqual(hotspot.member_issue_ids, ids, "members: exactly the four issues, oldest first");
    assert.equal(hotspot.current_issue_count, 4);
    assert.equal(hotspot.baseline_issue_count, 0);
    assert.equal(hotspot.expected_current_count, 0);
    assert.equal(hotspot.trend_percent, 400);
    // trend ≥ 200 % but current < critical_min_current_count (6): capped at HIGH (02 §6.5).
    assert.equal(hotspot.severity, "HIGH");
    assert.equal(hotspot.explanation, "4 GARBAGE issues within ~300 m in the last 2 h (expected 0.0) — trend +400%.");
    for (const p of points) assert.ok(polygonContains(hotspot.geometry, p), `the hotspot does not cover ${p.lat},${p.lng}`);
  });

  await t.test("supporting report: does not regenerate City Pulse, and never adds to the count (06 rule 7, 02 §6.1)", async (st: TestContext) => {
    assert.ok(auth && garbage.length === 4, "depends on the after() subtest");
    const ids = garbage.map((g) => g.issueId);
    const target = garbage[0]!;

    // Let pending after() runs from our own four reports land first.
    const g0 = await settledGeneratedAt();
    assert.ok(g0, "no active hotspots before the support");

    // A fifth citizen: "This is the same issue" on the first GARBAGE issue, a few metres away.
    const supporter = await newCitizen();
    const at = offsetPoint(target.point.lat, target.point.lng, 5, 5);
    const body = reportBody(await uploadPhoto(supporter), { category: "GARBAGE", lat: at.lat, lng: at.lng });
    const supported = expectOk(
      await api("POST", `/api/issues/${target.issueId}/support`, { token: supporter.accessToken, body }),
      supportReportResponseSchema,
      [201],
    );
    assert.equal(supported.created_new_issue, false);
    assert.equal(supported.issue_id, target.issueId);

    // No after() for supports: the active generation is unchanged ~3 s later.
    await sleep(3_000);
    const g1 = expectHotspotSet(await getHotspots());
    if (g1 === null || Date.parse(g1) !== Date.parse(g0)) {
      // Another test file's NEW issue regenerates too (its own after()). Only then is a change explained.
      const since = new Date(Date.parse(g0) - EDGE_MARGIN_MS).toISOString();
      const { data, error } = await adminClient().from("issues").select("id").gt("created_at", since);
      if (error) throw new Error(`issues lookup failed: ${error.message}`);
      const others = (data as { id: string }[]).filter((r) => !ids.includes(r.id));
      assert.ok(
        others.length > 0,
        `City Pulse regenerated after a supporting report (generated_at ${g0} → ${g1}); supports must not trigger it (02 §6.8)`,
      );
      st.diagnostic(`generation changed, but ${others.length} new issue(s) from other test files explain it; "no regeneration" not checked`);
    }

    // Supports are reports, not issues: after a regenerate the cluster still counts 4.
    const regen = await regenerateHotspots(auth);
    const hotspot = garbageHotspotOf(regen.hotspots, ids);
    assert.ok(hotspot, "the GARBAGE hotspot disappeared after a supporting report");
    assert.deepEqual(hotspot.member_issue_ids, ids);
    assert.equal(hotspot.current_issue_count, 4, "a supporting report increased the hotspot count");
    assert.equal(hotspot.baseline_issue_count, 0);
    assert.equal(hotspot.severity, "HIGH");
  });

  await t.test("rejected member: hidden from member_issue_ids; after regenerate the 3 left are below minpoints → no GARBAGE hotspot", async () => {
    assert.ok(auth && garbage.length === 4, "depends on the after() subtest");
    const ids = garbage.map((g) => g.issueId);
    const rejectedId = garbage[1]!.issueId;

    const rejected = expectOk(
      await api("PATCH", `/api/issues/${rejectedId}/status`, {
        token: auth.accessToken,
        body: { to_status: "REJECTED", note: "[integration test] City Pulse: not a civic issue" },
      }),
      transitionIssueResponseSchema,
    );
    assert.equal(rejected.status, "REJECTED");

    // Before any regenerate, the stored hotspot (if still active) no longer lists it publicly.
    const stored = garbageHotspotOf(await getHotspots(), ids);
    if (stored) {
      assert.ok(!stored.member_issue_ids.includes(rejectedId), "a REJECTED issue is still listed as a hotspot member");
      assert.deepEqual(stored.member_issue_ids, ids.filter((id) => id !== rejectedId));
    }

    const regen = await regenerateHotspots(auth);
    assert.equal(garbageHotspotOf(regen.hotspots, ids), undefined, "a GARBAGE hotspot remains with 3 open issues (minpoints 4)");
    assert.equal(garbageHotspotOf(await getHotspots(), ids), undefined, "GET still shows the GARBAGE hotspot");
  });
});

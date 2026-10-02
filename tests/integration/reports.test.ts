/**
 * POST /api/reports end to end (02 §7.3, §9, §10.2, §13; phase-1 contract), plus the reads that
 * must show the new report: GET /api/issues/:id, GET /api/issues, GET /api/my-reports.
 *
 * Rows created here cannot be deleted (issue_events is append-only); `npm run demo:reset`
 * clears them. Every report uses category OTHER and a "[integration test]" description.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { RATE_LIMIT_CONFIG, STORAGE_BUCKETS } from "../../src/config/civic.ts";
import { issueDetailResponseSchema, issuesResponseSchema } from "../../src/contracts/issues.ts";
import { myReportsResponseSchema } from "../../src/contracts/reports.ts";
import {
  adminClient,
  api,
  bboxAround,
  countReportsBy,
  createReport,
  env,
  expectError,
  expectOk,
  jsonStrings,
  newCitizen,
  photoPath,
  postReport,
  PRIVATE_KEYS,
  publicPhotoUrl,
  randomFakeIp,
  RATE_LIMITED_MESSAGE,
  reportBody,
  RUN_IP,
  testOptions,
  uploadPhoto,
} from "./helpers.ts";

const COORD_EPSILON = 1e-6;

test("create: a citizen's report becomes a public REPORTED issue, in their My Reports only", testOptions(), async () => {
  const citizen = await newCitizen();
  const other = await newCitizen();
  const description = `[integration test] create ${randomUUID().slice(0, 8)}`;

  const { issueId, reportId, body } = await createReport(citizen, {
    // Whitespace around the description must be trimmed (contract: "Description is trimmed").
    body: { description: `  ${description}  `, citizen_severity: "HIGH" },
  });
  const point = { lat: body.lat, lng: body.lng };
  const imageUrl = publicPhotoUrl(STORAGE_BUCKETS.reportPhotos, body.image_path);

  // --- GET /api/issues/:id: public, sanitised detail ------------------------------------------
  const detailRes = await api("GET", `/api/issues/${issueId}`, { ip: null });
  const detail = expectOk(detailRes, issueDetailResponseSchema);
  assert.equal(detail.id, issueId);
  assert.equal(detail.status, "REPORTED");
  assert.equal(detail.category, "OTHER");
  assert.equal(detail.citizen_severity, "HIGH");
  assert.equal(detail.is_seed, false);
  assert.equal(detail.report_count, 1);
  assert.ok(Math.abs(detail.lat - point.lat) < COORD_EPSILON && Math.abs(detail.lng - point.lng) < COORD_EPSILON);
  assert.equal(detail.photos.length, 1);
  assert.equal(detail.photos[0]?.id, reportId);
  assert.equal(detail.photos[0]?.image_url, imageUrl);
  assert.equal(detail.photos[0]?.description, description);
  const created = detail.timeline.filter((e) => e.event_type === "CREATED");
  assert.equal(created.length, 1, JSON.stringify(detail.timeline));
  assert.equal(created[0]?.from_status, null);
  assert.equal(created[0]?.to_status, "REPORTED");
  assert.equal(created[0]?.actor, "CITIZEN");

  // Privacy (02 §7.4, 06 rule 22): no reporter id / ip hash / actor id anywhere in the JSON.
  // image_url is excluded from the uid scan: the mandated object path {uid}/{uuid}.jpg (02 §10.2)
  // necessarily embeds the uploader's uid in the public photo URL.
  for (const s of jsonStrings(detailRes.json, ["image_url"])) {
    assert.ok(!s.includes(citizen.userId), `issue detail leaks the reporter uid in ${JSON.stringify(s)}`);
    assert.ok(!(PRIVATE_KEYS as readonly string[]).includes(s), `issue detail exposes key ${s}`);
  }
  // Even signed in as the reporter, the public detail stays sanitised.
  const ownDetailRes = await api("GET", `/api/issues/${issueId}`, { token: citizen.accessToken });
  expectOk(ownDetailRes, issueDetailResponseSchema);
  for (const s of jsonStrings(ownDetailRes.json, ["image_url"])) {
    assert.ok(!s.includes(citizen.userId), `issue detail (as reporter) leaks the reporter uid in ${JSON.stringify(s)}`);
  }

  // --- GET /api/issues?bbox: the map shows it ----------------------------------------------------
  const markers = expectOk(await api("GET", `/api/issues?bbox=${bboxAround(point)}`, { ip: null }), issuesResponseSchema);
  const marker = markers.find((m) => m.id === issueId);
  assert.ok(marker, `issue ${issueId} missing from the bbox around it`);
  assert.equal(marker.status, "REPORTED");
  assert.equal(marker.report_count, 1);
  const filtered = expectOk(
    await api("GET", `/api/issues?bbox=${bboxAround(point)}&category=POTHOLE`, { ip: null }),
    issuesResponseSchema,
  );
  assert.ok(!filtered.some((m) => m.id === issueId), "category filter must exclude the OTHER issue");

  // --- GET /api/my-reports: the reporter sees it, nobody else does --------------------------------
  const mineRes = await api("GET", "/api/my-reports", { token: citizen.accessToken });
  const mine = expectOk(mineRes, myReportsResponseSchema);
  assert.equal(mine.length, 1);
  const report = mine[0]!;
  assert.equal(report.id, reportId);
  assert.equal(report.issue.id, issueId);
  assert.equal(report.issue.status, "REPORTED");
  assert.equal(report.issue.report_count, 1);
  assert.equal(report.issue.latest_resolution_evidence, null);
  assert.equal(report.image_url, imageUrl);
  assert.equal(report.description, description);
  assert.equal(report.citizen_severity, "HIGH");
  for (const s of jsonStrings(mineRes.json)) {
    assert.ok(!(PRIVATE_KEYS as readonly string[]).includes(s), `my-reports exposes key ${s}`);
  }

  const theirs = expectOk(await api("GET", "/api/my-reports", { token: other.accessToken }), myReportsResponseSchema);
  assert.deepEqual(theirs, [], "a second citizen must not see someone else's report");

  // --- What create_report wrote (service role) ----------------------------------------------------
  const db = adminClient();
  const { data: issueRow, error: issueErr } = await db
    .from("issues")
    .select("status, category, citizen_severity, is_seed")
    .eq("id", issueId)
    .single();
  assert.equal(issueErr, null);
  assert.deepEqual(issueRow, { status: "REPORTED", category: "OTHER", citizen_severity: "HIGH", is_seed: false });

  const { data: reportRow, error: reportErr } = await db
    .from("reports")
    .select("issue_id, reporter_user_id, reporter_ip_hash, image_path, description")
    .eq("id", reportId)
    .single();
  assert.equal(reportErr, null);
  assert.equal(reportRow?.issue_id, issueId);
  assert.equal(reportRow?.reporter_user_id, citizen.userId);
  assert.equal(reportRow?.image_path, body.image_path);
  assert.equal(reportRow?.description, description);
  assert.match(String(reportRow?.reporter_ip_hash), /^[0-9a-f]{64}$/, "reporter_ip_hash must be SHA-256 hex");
  if (env.ipHashSalt) {
    const expected = createHash("sha256").update(RUN_IP + env.ipHashSalt).digest("hex");
    assert.equal(reportRow?.reporter_ip_hash, expected, "hash of the first x-forwarded-for entry + IP_HASH_SALT");
  }

  const { data: events, error: eventsErr } = await db
    .from("issue_events")
    .select("event_type, actor_user_id, from_status, to_status")
    .eq("issue_id", issueId);
  assert.equal(eventsErr, null);
  assert.deepEqual(events, [
    { event_type: "CREATED", actor_user_id: citizen.userId, from_status: null, to_status: "REPORTED" },
  ]);
});

test("validation: bad body 400, no session 401, someone else's photo 403, missing photo 400", testOptions(), async () => {
  const citizen = await newCitizen();
  const other = await newCitizen();

  // Missing image_path → Zod.
  const { image_path: _omit, ...noPhoto } = reportBody(photoPath(citizen.userId));
  expectError(await api("POST", "/api/reports", { token: citizen.accessToken, body: noPhoto }), 400, "VALIDATION_FAILED");

  // Malformed JSON and an out-of-range latitude.
  expectError(await api("POST", "/api/reports", { token: citizen.accessToken, body: "{nope" }), 400, "VALIDATION_FAILED");
  const ownPath = await uploadPhoto(citizen);
  expectError(
    await api("POST", "/api/reports", { token: citizen.accessToken, body: reportBody(ownPath, { lat: 123 }) }),
    400,
    "VALIDATION_FAILED",
  );
  // Whitespace-only description (trimmed to empty).
  expectError(
    await api("POST", "/api/reports", { token: citizen.accessToken, body: reportBody(ownPath, { description: "   " }) }),
    400,
    "VALIDATION_FAILED",
  );

  // No session, and a garbage bearer token → UNAUTHENTICATED (body is valid either way).
  expectError(await api("POST", "/api/reports", { body: reportBody(ownPath) }), 401, "UNAUTHENTICATED");
  expectError(
    await api("POST", "/api/reports", { token: "not-a-real-token", body: reportBody(ownPath) }),
    401,
    "UNAUTHENTICATED",
  );

  // A photo that exists, but in another citizen's folder → FORBIDDEN (route check, 02 §10.2).
  const theirPath = await uploadPhoto(other);
  expectError(
    await api("POST", "/api/reports", { token: citizen.accessToken, body: reportBody(theirPath) }),
    403,
    "FORBIDDEN",
  );

  // A well-formed path in the caller's folder that was never uploaded → VALIDATION_FAILED (SQL check).
  const message = expectError(
    await api("POST", "/api/reports", { token: citizen.accessToken, body: reportBody(photoPath(citizen.userId)) }),
    400,
    "VALIDATION_FAILED",
  );
  assert.ok(!/storage\.objects|PT400|sqlstate/i.test(message), `DB details must not leak: ${message}`);

  assert.equal(await countReportsBy(citizen.userId), 0, "no rejected request may create a report");
  assert.equal(await countReportsBy(other.userId), 0);
});

test(
  `per-user rate limit: report ${RATE_LIMIT_CONFIG.max_reports_per_user + 1} in the window → 429 RATE_LIMITED`,
  testOptions(),
  async () => {
    const citizen = await newCitizen();
    for (let i = 0; i < RATE_LIMIT_CONFIG.max_reports_per_user; i++) await createReport(citizen);

    const { res } = await postReport(citizen);
    const message = expectError(res, 429, "RATE_LIMITED");
    assert.equal(message, RATE_LIMITED_MESSAGE);

    // It is the user's limit, not the IP's: a different IP does not help.
    const { res: otherIp } = await postReport(citizen, { ip: randomFakeIp() });
    assert.equal(expectError(otherIp, 429, "RATE_LIMITED"), RATE_LIMITED_MESSAGE);

    assert.equal(await countReportsBy(citizen.userId), RATE_LIMIT_CONFIG.max_reports_per_user);

    // Another citizen on the same IP is unaffected.
    await createReport(await newCitizen());
  },
);

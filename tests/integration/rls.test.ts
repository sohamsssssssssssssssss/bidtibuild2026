/**
 * RLS and grants seen from a real anonymous citizen's Supabase client (02 §7.3, §10.2, §15;
 * 04 §4): no direct table writes, no reading other people's reports or the raw audit tables,
 * no calling service-role functions, and Storage uploads only into the caller's own
 * report-photos folder. Every "blocked" claim is double-checked with the service role.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { RATE_LIMIT_CONFIG, STORAGE_BUCKETS } from "../../src/config/civic.ts";
import {
  adminClient,
  anonClient,
  countReportsBy,
  createReport,
  newCitizen,
  photoPath,
  randomMumbaiPoint,
  testOptions,
  tryUpload,
  uploadPhoto,
} from "./helpers.ts";

interface WriteResult {
  error: { message: string } | null;
  data: unknown;
}

/** A direct write is blocked if PostgREST refuses it (42501) or it touches zero rows. */
function assertBlocked(label: string, r: WriteResult): void {
  const touched = Array.isArray(r.data) ? r.data.length : r.data ? 1 : 0;
  assert.ok(r.error !== null || touched === 0, `${label} should be blocked, but it affected ${touched} row(s)`);
}

async function existsById(table: string, id: string): Promise<boolean> {
  const { data, error } = await adminClient().from(table).select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return data !== null;
}

async function objectExists(bucket: string, path: string): Promise<boolean> {
  const { data, error } = await adminClient().storage.from(bucket).download(path);
  return error === null && data !== null;
}

test("RLS: a citizen cannot insert, update or delete issues, reports, issue_events or users", testOptions(), async () => {
  const owner = await newCitizen();
  const { issueId, reportId } = await createReport(owner);
  const attacker = await newCitizen();
  const db = adminClient();
  const at = randomMumbaiPoint();
  const geom = `SRID=4326;POINT(${at.lng} ${at.lat})`;

  // The new issue's CREATED event (service-role lookup) — a target for update/delete.
  const { data: ev, error: evErr } = await db.from("issue_events").select("id").eq("issue_id", issueId).single();
  assert.equal(evErr, null);
  const eventId = (ev as { id: string }).id;

  for (const who of [
    { name: "reporter", client: owner.client },
    { name: "other citizen", client: attacker.client },
    { name: "anon (no session)", client: anonClient() },
  ]) {
    const c = who.client;
    const label = (s: string) => `${who.name}: ${s}`;

    // INSERT
    const newIssueId = randomUUID();
    assertBlocked(
      label("insert issues"),
      await c.from("issues").insert({ id: newIssueId, category: "OTHER", status: "REPORTED", geom }).select(),
    );
    assert.equal(await existsById("issues", newIssueId), false, label("issue row was created"));

    const newReportId = randomUUID();
    assertBlocked(
      label("insert reports"),
      await c
        .from("reports")
        .insert({
          id: newReportId,
          issue_id: issueId,
          reporter_user_id: owner.userId,
          category: "OTHER",
          description: "direct insert",
          image_path: photoPath(owner.userId),
          geom,
        })
        .select(),
    );
    assert.equal(await existsById("reports", newReportId), false, label("report row was created"));

    const newEventId = randomUUID();
    assertBlocked(
      label("insert issue_events"),
      await c
        .from("issue_events")
        .insert({ id: newEventId, issue_id: issueId, event_type: "RESOLVED", to_status: "RESOLVED" })
        .select(),
    );
    assert.equal(await existsById("issue_events", newEventId), false, label("event row was created"));

    // UPDATE
    assertBlocked(
      label("update issues"),
      await c.from("issues").update({ final_priority: "CRITICAL" }).eq("id", issueId).select(),
    );
    assertBlocked(
      label("update reports"),
      await c.from("reports").update({ description: "tampered" }).eq("id", reportId).select(),
    );
    assertBlocked(
      label("update issue_events"),
      await c.from("issue_events").update({ note: "tampered" }).eq("id", eventId).select(),
    );

    // DELETE
    assertBlocked(label("delete issue_events"), await c.from("issue_events").delete().eq("id", eventId).select());
    assertBlocked(label("delete reports"), await c.from("reports").delete().eq("id", reportId).select());
    assertBlocked(label("delete issues"), await c.from("issues").delete().eq("id", issueId).select());
  }

  // Privilege escalation: a citizen cannot make themselves an authority (02 §7.2).
  assertBlocked(
    "insert users (self as AUTHORITY)",
    await attacker.client
      .from("users")
      .insert({ id: attacker.userId, name: "Not An Authority", email: "x@example.invalid", role: "AUTHORITY" })
      .select(),
  );
  assert.equal(await existsById("users", attacker.userId), false, "citizen became a users row");

  // Nothing changed.
  const { data: issue } = await db.from("issues").select("status, final_priority").eq("id", issueId).single();
  assert.deepEqual(issue, { status: "REPORTED", final_priority: null });
  const { data: report } = await db.from("reports").select("description").eq("id", reportId).single();
  assert.notEqual((report as { description: string }).description, "tampered");
  const { data: events } = await db.from("issue_events").select("id, note").eq("issue_id", issueId);
  assert.deepEqual(events, [{ id: eventId, note: null }]);
});

test("RLS: a citizen reads only their own reports, and never issue_events or resolution_evidence", testOptions(), async () => {
  const owner = await newCitizen();
  const { reportId } = await createReport(owner);
  const other = await newCitizen();
  const db = adminClient();

  // Positive control: the reporter can read their own report row directly.
  const own = await owner.client.from("reports").select("id").eq("id", reportId);
  assert.equal(own.error, null);
  assert.deepEqual(own.data, [{ id: reportId }]);

  // Another citizen and an anon client see nothing — not the new report, not the seed's.
  for (const [name, c] of [
    ["other citizen", other.client],
    ["anon", anonClient()],
  ] as const) {
    const byId = await c.from("reports").select("id").eq("id", reportId);
    assert.ok(byId.error !== null || (byId.data ?? []).length === 0, `${name} read someone else's report`);
    // Neither has a report of its own, so an unfiltered read must come back empty.
    const all = await c.from("reports").select("id").limit(50);
    assert.ok(all.error !== null || (all.data ?? []).length === 0, `${name} can list other people's reports`);
  }

  // Raw audit tables are authority-only (citizens get the sanitised timeline via the API).
  const { count: eventCount } = await db.from("issue_events").select("id", { count: "exact", head: true });
  assert.ok((eventCount ?? 0) > 0, "precondition: issue_events has rows");
  for (const c of [owner.client, other.client, anonClient()]) {
    const events = await c.from("issue_events").select("id").limit(10);
    assert.ok(events.error !== null || (events.data ?? []).length === 0, "citizen can read issue_events");
    const evidence = await c.from("resolution_evidence").select("id").limit(10);
    assert.ok(evidence.error !== null || (evidence.data ?? []).length === 0, "citizen can read resolution_evidence");
    const users = await c.from("users").select("id").limit(10);
    assert.ok(users.error !== null || (users.data ?? []).length === 0, "citizen can read authority users");
  }
});

test("RLS: a citizen cannot call service-role functions (create_report, my_reports)", testOptions(), async () => {
  const victim = await newCitizen();
  await createReport(victim);
  const attacker = await newCitizen();
  const path = await uploadPhoto(attacker);
  const at = randomMumbaiPoint();

  // create_report directly: would skip the route's session check and IP hashing (02 §7.3).
  for (const c of [attacker.client, anonClient()]) {
    const { error } = await c.rpc("create_report", {
      p_actor_id: attacker.userId,
      p_ip_hash: null,
      p_category: "OTHER",
      p_citizen_severity: null,
      p_description: "[integration test] direct rpc",
      p_image_path: path,
      p_lat: at.lat,
      p_lng: at.lng,
      p_config: RATE_LIMIT_CONFIG,
    });
    assert.ok(error !== null, "create_report must not be executable by citizens");
  }
  assert.equal(await countReportsBy(attacker.userId), 0, "a direct rpc created a report");

  // my_reports(p_user_id) for someone else would leak their reports.
  const { data, error } = await attacker.client.rpc("my_reports", { p_user_id: victim.userId });
  assert.ok(error !== null, `my_reports must not be executable by citizens (got ${JSON.stringify(data)})`);
});

test("Storage: uploads only into the caller's own report-photos folder; photos cannot be replaced or deleted", testOptions(), async () => {
  const citizen = await newCitizen();
  const other = await newCitizen();

  // Own folder works (positive control).
  const ownPath = await uploadPhoto(citizen);
  assert.equal(await objectExists(STORAGE_BUCKETS.reportPhotos, ownPath), true);

  // Another uid's folder.
  const foreign = photoPath(other.userId);
  assert.notEqual(await tryUpload(citizen.client, STORAGE_BUCKETS.reportPhotos, foreign), null, "uploaded into another uid's folder");
  assert.equal(await objectExists(STORAGE_BUCKETS.reportPhotos, foreign), false);

  // The bucket root (no uid folder).
  const rootPath = `${randomUUID()}.jpg`;
  assert.notEqual(await tryUpload(citizen.client, STORAGE_BUCKETS.reportPhotos, rootPath), null, "uploaded outside a uid folder");

  // resolution-photos is authority-only, even in the citizen's own folder.
  const resolution = photoPath(citizen.userId);
  assert.notEqual(
    await tryUpload(citizen.client, STORAGE_BUCKETS.resolutionPhotos, resolution),
    null,
    "citizen uploaded into resolution-photos",
  );
  assert.equal(await objectExists(STORAGE_BUCKETS.resolutionPhotos, resolution), false);

  // No session at all.
  const anonPath = photoPath(randomUUID());
  assert.notEqual(await tryUpload(anonClient(), STORAGE_BUCKETS.reportPhotos, anonPath), null, "anon uploaded a photo");

  // No UPDATE/DELETE policies (02 §10.3: kept for audit): upsert over and remove of an own photo fail.
  assert.notEqual(
    await tryUpload(citizen.client, STORAGE_BUCKETS.reportPhotos, ownPath, { upsert: true }),
    null,
    "citizen overwrote an uploaded photo",
  );
  await citizen.client.storage.from(STORAGE_BUCKETS.reportPhotos).remove([ownPath]);
  assert.equal(await objectExists(STORAGE_BUCKETS.reportPhotos, ownPath), true, "citizen deleted an uploaded photo");
});

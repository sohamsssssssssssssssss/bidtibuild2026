/**
 * GET /api/stats/resolution (02 §13): public, counts only, one row per category; resolving a fresh
 * issue moves it from open_count into resolved_count with its report-to-resolution time.
 * Uses FOOTPATH, which no other integration test resolves, so parallel test files don't skew it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, RESOLUTION_STATS_CONFIG } from "../../src/config/civic.ts";
import { resolutionStatsResponseSchema, type ResolutionStatsRow } from "../../src/contracts/stats.ts";
import { api, assignStartResolve, authority, authorityTestOptions, expectOk, newIssue, testOptions } from "./helpers.ts";

async function stats() {
  return expectOk(await api("GET", "/api/stats/resolution"), resolutionStatsResponseSchema);
}

function row(s: { categories: ResolutionStatsRow[] }, category: string): ResolutionStatsRow {
  const r = s.categories.find((c) => c.category === category);
  assert.ok(r, `no row for ${category}`);
  return r;
}

test("resolution stats: public, one row per category, counts only", testOptions(), async () => {
  const s = await stats();
  assert.equal(s.window_days, RESOLUTION_STATS_CONFIG.window_days);
  assert.deepEqual(
    s.categories.map((c) => c.category),
    [...CATEGORIES],
  );
  for (const c of s.categories) {
    if (c.resolved_count === 0) {
      assert.equal(c.avg_resolution_hours, null, `${c.category}: no resolutions → null average`);
      assert.equal(c.median_resolution_hours, null);
    }
    assert.ok(c.demo_resolved_count <= c.resolved_count);
  }
  assert.doesNotMatch(JSON.stringify(s), /[0-9a-f]{8}-[0-9a-f]{4}-/, "stats must not contain ids");
});

test("resolving an issue moves it from open to resolved", authorityTestOptions({ timeout: 60_000 }), async () => {
  const auth = await authority();
  const before = row(await stats(), "FOOTPATH");

  const issue = await newIssue({ body: { category: "FOOTPATH", description: "[integration test] broken paving slab" } });
  const opened = row(await stats(), "FOOTPATH");
  assert.equal(opened.open_count, before.open_count + 1, "a new issue counts as open");

  await assignStartResolve(auth, issue.issueId);
  const after = row(await stats(), "FOOTPATH");
  assert.equal(after.open_count, before.open_count, "resolved issues are no longer open");
  assert.equal(after.resolved_count, before.resolved_count + 1);
  assert.equal(after.demo_resolved_count, before.demo_resolved_count, "test issues are not demo data");
  assert.ok(after.avg_resolution_hours !== null && after.median_resolution_hours !== null);
});

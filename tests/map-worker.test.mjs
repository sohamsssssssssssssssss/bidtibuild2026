import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("MapLibre's worker and its sibling are served together", () => {
  const worker = readFileSync("public/maplibre/maplibre-gl-worker.mjs", "utf8");
  const shared = readFileSync("public/maplibre/maplibre-gl-shared.mjs", "utf8");
  assert.match(worker, /maplibre-gl-shared\.mjs/);
  assert.ok(shared.length > 0);
});

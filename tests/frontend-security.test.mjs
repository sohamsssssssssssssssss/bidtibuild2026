import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

const files = ["src/lib/supabase/browser.ts", "src/components/map/CityMap.tsx", "src/components/auth/AuthoritySession.tsx"];

test("browser code never refers to service-role credentials", () => {
  for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), /SUPABASE_SERVICE_ROLE_KEY|service_role/);
});

test("MapLibre worker is available as a local asset", () => {
  assert.ok(existsSync("public/maplibre/maplibre-gl-worker.mjs"));
});

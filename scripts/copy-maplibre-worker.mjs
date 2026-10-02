import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const worker = require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs");
const shared = require.resolve("maplibre-gl/dist/maplibre-gl-shared.mjs");
const destination = join(process.cwd(), "public", "maplibre");
mkdirSync(destination, { recursive: true });
copyFileSync(worker, join(destination, "maplibre-gl-worker.mjs"));
copyFileSync(shared, join(destination, "maplibre-gl-shared.mjs"));

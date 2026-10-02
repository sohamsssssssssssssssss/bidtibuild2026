import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const source = path.join(process.cwd(), "node_modules", "maplibre-gl", "dist");
const destination = path.join(process.cwd(), "public", "maplibre");
mkdirSync(destination, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(source, file), path.join(destination, file));
}

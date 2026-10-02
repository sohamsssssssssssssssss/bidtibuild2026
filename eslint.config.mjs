import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "public/maplibre/**"]),
  // e2e/support/judge.ts has a Playwright fixture helper named `use`, not a React hook.
  {
    files: ["e2e/support/judge.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
]);

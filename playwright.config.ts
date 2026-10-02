import { defineConfig } from "@playwright/test";

/**
 * Judge-path E2E (02 §15): `npm run test:e2e`. See e2e/README.md.
 *
 * Needs the local stack (`supabase start` + `npm run demo:reset -- --local`). The dev server is
 * reused if it's already running on APP_URL, otherwise started.
 */
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
// Optional: point at an installed Chromium when `npx playwright install chromium` isn't possible.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./e2e",
  // One demo database, so specs run one at a time in a fixed order.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL: APP_URL,
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: `${APP_URL}/api/hotspots`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

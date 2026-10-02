/**
 * Shared setup for the judge-path E2E (03 §6, 02 §15): three isolated browser sessions, the
 * screens' routes, a test photo, and preflight checks on the demo data.
 */
import { test as base, devices, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { CATEGORY_RADIUS_M, DEMO_SPOT } from "../../src/config/civic";
import { TESTIDS } from "../../src/config/testids";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* optional */
}
try {
  process.loadEnvFile(".env");
} catch {
  /* optional */
}

/**
 * Screen routes the page objects navigate to. These are the E2E test's assumptions about the
 * frontend's URLs — update them here if the app uses different paths.
 */
export const ROUTES = {
  home: "/",
  myReports: "/my-reports",
  authorityLogin: "/authority/login",
  authorityHome: "/authority",
} as const;

export const AUTHORITY = {
  email: process.env.AUTHORITY_EMAIL ?? "",
  password: process.env.AUTHORITY_PASSWORD ?? "",
};

/** Citizen B stands ~10 m north of DEMO_SPOT — inside the 50 m POTHOLE duplicate radius. */
export const CITIZEN_B_SPOT = { lat: DEMO_SPOT.lat + 10 / 111_320, lng: DEMO_SPOT.lng };

/** A 1×1 baseline JPEG; the browser photo helper decodes and re-encodes it (02 §10.1). */
export const TEST_PHOTO = {
  name: "pothole.jpg",
  mimeType: "image/jpeg",
  // Same bytes as TINY_JPEG in tests/integration/helpers.ts.
  buffer: Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/" +
      "2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDAREAAhEBAxEB/8QA" +
      "FAABAAAAAAAAAAAAAAAAAAAABv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAGB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAM" +
      "AwEAAhEDEQA/ADQwqT//2Q==",
    "base64",
  ),
};

export type Session = { context: BrowserContext; page: Page };

type JudgeFixtures = {
  /** Citizen A on a phone, located at DEMO_SPOT (03 §6). */
  citizenA: Session;
  /** Citizen B in a separate (incognito-equivalent) desktop context, ~10 m away. */
  citizenB: Session;
  /** The authority in its own desktop context — logging in replaces any anonymous session. */
  authority: Session;
};

async function session(
  browser: import("@playwright/test").Browser,
  options: Parameters<import("@playwright/test").Browser["newContext"]>[0],
): Promise<Session> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  return { context, page };
}

export const test = base.extend<JudgeFixtures>({
  citizenA: async ({ browser }, use) => {
    const s = await session(browser, {
      ...devices["Pixel 7"],
      geolocation: { latitude: DEMO_SPOT.lat, longitude: DEMO_SPOT.lng },
      permissions: ["geolocation"],
    });
    await use(s);
    await s.context.close();
  },
  citizenB: async ({ browser }, use) => {
    const s = await session(browser, {
      viewport: { width: 1280, height: 800 },
      geolocation: { latitude: CITIZEN_B_SPOT.lat, longitude: CITIZEN_B_SPOT.lng },
      permissions: ["geolocation"],
    });
    await use(s);
    await s.context.close();
  },
  authority: async ({ browser }, use) => {
    const s = await session(browser, { viewport: { width: 1440, height: 900 } });
    await use(s);
    await s.context.close();
  },
});

export { expect };

/** True once the frontend renders its app shell on `/` (the screens may not exist yet). */
export async function uiReady(page: Page): Promise<boolean> {
  const res = await page.goto(ROUTES.home);
  if (!res || !res.ok()) return false;
  return (await page.getByTestId(TESTIDS.appShell).count()) > 0;
}

function bboxAround(p: { lat: number; lng: number }, d: number): string {
  return [p.lng - d, p.lat - d, p.lng + d, p.lat + d].join(",");
}

type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };

async function getData<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path);
  const body = (await res.json()) as Envelope<T>;
  expect(res.ok(), `${path} → ${res.status()} ${body.error?.message ?? ""}`).toBeTruthy();
  return body.data as T;
}

/**
 * Preconditions of the judge script, checked through the public API (no DB access): the demo spot
 * is clear for a fresh pothole, and City Pulse shows the seeded CRITICAL DRAINAGE hotspot.
 * Fails with a "run demo:reset" hint, so a stale database never looks like an app bug.
 */
export async function expectFreshDemoData(request: APIRequestContext): Promise<void> {
  const hint = "— run `npm run demo:reset -- --local` (or `npm run demo:reset`) and try again";
  const deg = (CATEGORY_RADIUS_M.POTHOLE * 2) / 111_320;
  const potholes = await getData<{ status: string }[]>(
    request,
    `/api/issues?bbox=${bboxAround(DEMO_SPOT, deg)}&category=POTHOLE`,
  );
  expect(potholes, `an open pothole already sits at DEMO_SPOT ${hint}`).toHaveLength(0);

  const hotspots = await getData<{ category: string; severity: string }[]>(request, "/api/hotspots");
  expect(
    hotspots.some((h) => h.category === "DRAINAGE" && h.severity === "CRITICAL"),
    `no CRITICAL DRAINAGE hotspot (the seeded scenario ages out ~90 min after a reset) ${hint}`,
  ).toBeTruthy();
}

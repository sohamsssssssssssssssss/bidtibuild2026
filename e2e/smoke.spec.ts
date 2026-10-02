/**
 * Framework smoke test: runs before the UI exists. Proves the three judge sessions are isolated,
 * set up as the demo needs (phone + location), and can reach the API, and that the demo data is
 * fresh enough for the judge script.
 */
import { DEMO_SPOT } from "../src/config/civic";
import { CITIZEN_B_SPOT, expect, expectFreshDemoData, test } from "./support/judge";

test("three isolated judge sessions reach the API", async ({ citizenA, citizenB, authority }) => {
  // Citizen A is on a phone-sized screen (02 §15, 05 §5: 375 px class).
  const vpA = citizenA.page.viewportSize();
  expect(vpA && vpA.width < 500, "citizen A should use a phone viewport").toBeTruthy();

  // Each session is its own browser context: nothing stored in one is visible to another.
  await citizenA.context.addCookies([{ name: "probe", value: "a", url: "http://localhost" }]);
  expect(await citizenB.context.cookies()).toHaveLength(0);
  expect(await authority.context.cookies()).toHaveLength(0);

  // Geolocation is granted and pinned: A at DEMO_SPOT, B ~10 m away.
  await citizenA.page.goto("/api/hotspots");
  const posA = await citizenA.page.evaluate(
    () =>
      new Promise<{ lat: number; lng: number }>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          reject,
        ),
      ),
  );
  expect(posA.lat).toBeCloseTo(DEMO_SPOT.lat, 5);
  expect(posA.lng).toBeCloseTo(DEMO_SPOT.lng, 5);
  await citizenB.page.goto("/api/hotspots");
  const posB = await citizenB.page.evaluate(
    () =>
      new Promise<number>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition((p) => resolve(p.coords.latitude), reject),
      ),
  );
  expect(posB).toBeCloseTo(CITIZEN_B_SPOT.lat, 5);

  // Every session can call the API.
  for (const s of [citizenA, citizenB, authority]) {
    const res = await s.page.request.get("/api/hotspots");
    expect(res.ok()).toBeTruthy();
  }
});

test("demo data is fresh for the judge script", async ({ request }) => {
  await expectFreshDemoData(request);

  // Seeded issues are on the map and flagged as demo data (06 rule 2).
  const res = await request.get("/api/issues?bbox=72.80,18.90,73.00,19.15");
  const body = (await res.json()) as { data: { is_seed: boolean }[] };
  expect(body.data.filter((i) => i.is_seed).length).toBeGreaterThanOrEqual(30);
});

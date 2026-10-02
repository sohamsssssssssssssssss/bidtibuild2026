/**
 * npm run demo:check [-- --url https://<app>]  — pre-demo checklist against a running app.
 *
 * Checks what the judge script (03 §6) depends on, through the public API plus two sign-ins:
 *   1. the app answers
 *   2. City Pulse shows a CRITICAL DRAINAGE hotspot, and how long it stays CRITICAL
 *   3. DEMO_SPOT is clear (no pothole within the duplicate radius, nothing else nearby)
 *   4. seeded demo issues are on the map
 *   5. the photo route answers
 *   6. anonymous (citizen) sign-in works            (needs NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY)
 *   7. the authority login works and sees the queue (also needs AUTHORITY_EMAIL / _PASSWORD)
 * Exit code 1 if anything FAILs. It writes nothing except one anonymous auth user (check 6).
 *
 * Run with Node >= 22.18 (type stripping). Env from .env.local / .env; APP_URL or --url picks the app.
 */
import { createClient } from "@supabase/supabase-js";
import { CATEGORY_RADIUS_M, CITY_PULSE_CONFIG, DEMO_SPOT } from "../src/config/civic.ts";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* optional */
  }
}

const urlArg = process.argv.indexOf("--url");
const APP_URL = (urlArg > -1 ? process.argv[urlArg + 1] : process.env.APP_URL) ?? "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const AUTHORITY_EMAIL = process.env.AUTHORITY_EMAIL ?? "";
const AUTHORITY_PASSWORD = process.env.AUTHORITY_PASSWORD ?? "";
/** Below this many minutes of CRITICAL left, warn: the demo could start too late. */
const MIN_MINUTES_LEFT = 30;

type Result = "PASS" | "WARN" | "FAIL";
const results: { result: Result; name: string; detail: string }[] = [];
function record(result: Result, name: string, detail: string): void {
  results.push({ result, name, detail });
  const mark = result === "PASS" ? "✔" : result === "WARN" ? "!" : "✖";
  console.log(`${mark} ${result.padEnd(4)} ${name}${detail ? ` — ${detail}` : ""}`);
}

type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };
async function get<T>(path: string, token?: string): Promise<{ status: number; body: Envelope<T> | null }> {
  const res = await fetch(new URL(path, APP_URL), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(20_000),
  });
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}

function bbox(p: { lat: number; lng: number }, metres: number): string {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return [p.lng - dLng, p.lat - dLat, p.lng + dLng, p.lat + dLat].join(",");
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    record("FAIL", name, err instanceof Error ? err.message : String(err));
  }
}

type Hotspot = { category: string; severity: string; current_issue_count: number; member_issue_ids: string[] };
type Marker = { id: string; category: string; status: string; is_seed: boolean };

console.log(`Pre-demo check against ${APP_URL}\n`);

let appUp = false;
await check("App answers", async () => {
  const t0 = Date.now();
  const r = await get<Hotspot[]>("/api/hotspots");
  if (r.status !== 200) throw new Error(`GET /api/hotspots → ${r.status} ${r.body?.error?.message ?? ""}`);
  appUp = true;
  record("PASS", "App answers", `${Date.now() - t0} ms (a slow first answer is a cold start; open every screen once before presenting)`);
});

if (appUp) {
  await check("City Pulse hotspot", async () => {
    const hotspots = (await get<Hotspot[]>("/api/hotspots")).body?.data ?? [];
    const h = hotspots.find((x) => x.category === "DRAINAGE" && x.severity === "CRITICAL");
    if (!h) {
      const seen = hotspots.map((x) => `${x.severity} ${x.category}`).join(", ") || "none";
      throw new Error(`no CRITICAL DRAINAGE hotspot (active: ${seen}) — run npm run demo:reset`);
    }
    // CRITICAL needs >= critical_min_current_count members created within the current window.
    // Estimate when the one that keeps it at that count ages out (assuming no new drainage reports).
    const created: number[] = [];
    for (const id of h.member_issue_ids) {
      const d = await get<{ created_at: string }>(`/api/issues/${id}`);
      if (d.body?.data) created.push(Date.parse(d.body.data.created_at));
    }
    const windowMs = CITY_PULSE_CONFIG.current_window_hours * 3_600_000;
    const current = created.filter((t) => Date.now() - t < windowMs).sort((a, b) => a - b);
    const spare = current.length - CITY_PULSE_CONFIG.critical_min_current_count;
    if (spare < 0) {
      throw new Error(
        `shows CRITICAL but only ${current.length} member(s) are still in the ${CITY_PULSE_CONFIG.current_window_hours} h window; ` +
          "the next new report or Regenerate will downgrade it — run npm run demo:reset",
      );
    }
    const keyMember = current[spare] as number;
    const minutesLeft = Math.floor((keyMember + windowMs - Date.now()) / 60_000);
    const detail = `${h.current_issue_count} current issues; stays CRITICAL for about ${minutesLeft} more min`;
    record(minutesLeft < MIN_MINUTES_LEFT ? "WARN" : "PASS", "City Pulse hotspot", detail + (minutesLeft < MIN_MINUTES_LEFT ? " — reset closer to the demo" : ""));
  });

  await check("DEMO_SPOT is clear", async () => {
    const potholes = (await get<Marker[]>(`/api/issues?bbox=${bbox(DEMO_SPOT, CATEGORY_RADIUS_M.POTHOLE * 2)}&category=POTHOLE`)).body?.data;
    if (!potholes) throw new Error("GET /api/issues failed");
    if (potholes.length > 0) {
      throw new Error(`${potholes.length} pothole(s) near DEMO_SPOT (${potholes.map((p) => p.status).join(", ")}) — run npm run demo:reset`);
    }
    const nearby = (await get<Marker[]>(`/api/issues?bbox=${bbox(DEMO_SPOT, 150)}`)).body?.data ?? [];
    if (nearby.length > 0) {
      record("WARN", "DEMO_SPOT is clear", `no potholes, but ${nearby.length} other issue(s) within ~150 m`);
    } else {
      record("PASS", "DEMO_SPOT is clear", "no issues within ~150 m");
    }
  });

  await check("Seeded demo issues", async () => {
    const all = (await get<Marker[]>("/api/issues?bbox=72.75,18.85,73.05,19.30")).body?.data;
    if (!all) throw new Error("GET /api/issues failed");
    const seeded = all.filter((i) => i.is_seed).length;
    if (seeded < 30) throw new Error(`only ${seeded} seeded issues on the map (expected ~37) — run npm run demo:reset`);
    record("PASS", "Seeded demo issues", `${seeded} seeded, ${all.length - seeded} other on the map`);
  });

  await check("Photo route", async () => {
    const r = await get("/api/photos/report/00000000-0000-4000-8000-000000000000");
    if (r.status !== 404) throw new Error(`unknown photo → ${r.status}, expected 404`);
    record("PASS", "Photo route", "answers (404 for an unknown photo)");
  });

  if (!SUPABASE_URL || !ANON_KEY) {
    record("WARN", "Sign-ins", "skipped: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  } else {
    const supabase = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    await check("Citizen sign-in", async () => {
      const { data, error } = await supabase().auth.signInAnonymously();
      if (error || !data.session) {
        throw new Error(`anonymous sign-in failed: ${error?.message ?? "no session"} — enable anonymous sign-ins in the Supabase dashboard`);
      }
      const r = await get<unknown[]>("/api/my-reports", data.session.access_token);
      if (r.status !== 200) throw new Error(`GET /api/my-reports as a new citizen → ${r.status}`);
      record("PASS", "Citizen sign-in", "anonymous session works and My Reports answers");
    });

    if (!AUTHORITY_EMAIL || !AUTHORITY_PASSWORD) {
      record("WARN", "Authority login", "skipped: set AUTHORITY_EMAIL and AUTHORITY_PASSWORD");
    } else {
      await check("Authority login", async () => {
        const { data, error } = await supabase().auth.signInWithPassword({ email: AUTHORITY_EMAIL, password: AUTHORITY_PASSWORD });
        if (error || !data.session) throw new Error(`login failed: ${error?.message ?? "no session"} — run npm run demo:reset`);
        const r = await get<unknown[]>("/api/authority/queue", data.session.access_token);
        if (r.status !== 200) throw new Error(`GET /api/authority/queue → ${r.status} ${r.body?.error?.message ?? ""}`);
        record("PASS", "Authority login", `${AUTHORITY_EMAIL} sees ${(r.body?.data ?? []).length} open issues in the queue`);
      });
    }
  }
}

const failed = results.filter((r) => r.result === "FAIL").length;
const warned = results.filter((r) => r.result === "WARN").length;
console.log(`\n${failed ? "✖ NOT READY" : warned ? "! READY, with warnings" : "✔ READY"} — ${results.length} checks, ${failed} failed, ${warned} warnings`);
process.exit(failed ? 1 : 0);

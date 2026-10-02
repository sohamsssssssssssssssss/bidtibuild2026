/**
 * Shared helpers for the API-level integration tests (02 §15). They run against a REAL local
 * stack: `supabase start` + `npm run demo:reset -- --local` + `npm run dev`. See README.md.
 *
 * When the stack is not configured or not reachable, `skipReason` explains why and every test
 * passes it as `{ skip }`, so `npm run test:integration` exits 0 everywhere. Set
 * INTEGRATION_REQUIRED=1 (e.g. in CI) to turn that into a hard failure instead.
 *
 * Erasable TypeScript only (Node's native type stripping); src imports carry `.ts` and
 * register.ts resolves the extensionless imports inside src/contracts.
 */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  CITY_PULSE_CONFIG,
  CITY_PULSE_DEMO_CENTER,
  DEMO_SPOT,
  LEVELS,
  PRIORITY_CONFIG,
  priorityLabel,
  STORAGE_BUCKETS,
  type Category,
  type EventType,
  type Level,
  type SeveritySource,
  type StorageBucket,
} from "../../src/config/civic.ts";
import {
  authorityQueueResponseSchema,
  type AuthorityQueueRow,
  type PriorityFactors,
} from "../../src/contracts/authority.ts";
import { apiEnvelopeSchema, apiErrorSchema, type ErrorCode } from "../../src/contracts/envelope.ts";
import {
  hotspotsResponseSchema,
  regenerateHotspotsResponseSchema,
  type GeoJsonPolygon,
  type Hotspot,
  type RegenerateHotspotsResponse,
} from "../../src/contracts/hotspots.ts";
import {
  assignIssueResponseSchema,
  issueDetailResponseSchema,
  resolveIssueResponseSchema,
  transitionIssueResponseSchema,
  type AssignIssueResponse,
  type IssueDetail,
  type ResolveIssueResponse,
  type TimelineActor,
  type TimelineEvent,
  type TransitionIssueResponse,
} from "../../src/contracts/issues.ts";
import {
  createReportResponseSchema,
  myReportsResponseSchema,
  type CreateReportBodyInput,
  type MyReportsResponse,
} from "../../src/contracts/reports.ts";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

// Earlier files win: process.loadEnvFile never overrides a variable that is already set.
for (const file of ["../../.env.local", "../../.env"]) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(file, import.meta.url)));
  } catch {
    // missing file: fine
  }
}

const REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

const trimmed = (name: string): string => process.env[name]?.trim() ?? "";

export const env = {
  appUrl: (trimmed("APP_URL") || "http://localhost:3000").replace(/\/+$/, ""),
  supabaseUrl: trimmed("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, ""),
  anonKey: trimmed("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: trimmed("SUPABASE_SERVICE_ROLE_KEY"),
  /** Optional here (the app needs it); when set, tests also check the stored IP hash. */
  ipHashSalt: process.env.IP_HASH_SALT ?? "",
  /** The authority account `demo:reset` creates (scripts/demo-reset.ts lower-cases the email). */
  authorityEmail: trimmed("AUTHORITY_EMAIL").toLowerCase(),
  /** Not trimmed: demo-reset sets the password exactly as given. */
  authorityPassword: process.env.AUTHORITY_PASSWORD ?? "",
};

/** The friendly 429 message (phase-1 contract, 02 §9). Same text for both limits. */
export const RATE_LIMITED_MESSAGE =
  "You've sent a lot of reports in the last hour. Please try again a little later.";

// ---------------------------------------------------------------------------
// Stack detection → skip reason
// ---------------------------------------------------------------------------

/** TCP connect within `ms`, so "nothing listening" is detected fast. */
function tcpReachable(url: string, ms: number): Promise<boolean> {
  const u = new URL(url);
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  return new Promise((resolve) => {
    const socket = connect({ host: u.hostname, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(ms, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** A bbox around a point, formatted `minLng,minLat,maxLng,maxLat` (primitives.ts). */
export function bboxAround(p: LatLng, d = 0.0005): string {
  return [p.lng - d, p.lat - d, p.lng + d, p.lat + d].map((v) => v.toFixed(6)).join(",");
}

async function detectStack(): Promise<string | false> {
  const missing = REQUIRED_ENV.filter((n) => !trimmed(n));
  if (missing.length > 0) {
    return `integration stack not configured: missing ${missing.join(", ")} (see tests/integration/README.md)`;
  }

  if (!(await tcpReachable(env.supabaseUrl, 2000))) {
    return `Supabase not reachable at ${env.supabaseUrl} within 2 s (run \`npx supabase start\`)`;
  }
  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/health`, {
      headers: { apikey: env.anonKey },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status >= 500) return `Supabase Auth unhealthy at ${env.supabaseUrl} (HTTP ${res.status})`;
  } catch (err) {
    return `Supabase not reachable at ${env.supabaseUrl}: ${(err as Error).message}`;
  }

  if (!(await tcpReachable(env.appUrl, 2000))) {
    return `app not reachable at ${env.appUrl} within 2 s (run \`npm run dev\`, or set APP_URL)`;
  }
  // The port is open; the first request may compile the route in `next dev`, so allow longer.
  const probe = `${env.appUrl}/api/issues?bbox=${bboxAround(DEMO_SPOT)}`;
  try {
    const res = await fetch(probe, { signal: AbortSignal.timeout(60_000) });
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    if (res.status !== 200 || !Array.isArray(json?.data)) {
      return `GET ${probe} answered HTTP ${res.status} without an issues array — is the app on APP_URL CivicPulse, configured for this Supabase?`;
    }
  } catch (err) {
    return `GET ${probe} failed: ${(err as Error).message}`;
  }
  return false;
}

/** `false` when the stack is up; otherwise the reason every test is skipped. */
export const skipReason: string | false = await detectStack();

if (skipReason && process.env.INTEGRATION_REQUIRED === "1") {
  throw new Error(`INTEGRATION_REQUIRED=1 but ${skipReason}`);
}

/** Options for every test: skipped (with the reason) when the stack isn't there. */
export function testOptions(extra: { timeout?: number; skip?: string | false } = {}): {
  skip: string | false;
  timeout: number;
} {
  return { skip: skipReason || extra.skip || false, timeout: extra.timeout ?? 120_000 };
}

// ---------------------------------------------------------------------------
// Supabase clients
// ---------------------------------------------------------------------------

const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

let admin: SupabaseClient | undefined;

/** Service-role client for direct DB checks. Bypasses RLS — never use it as "the citizen". */
export function adminClient(): SupabaseClient {
  admin ??= createClient(env.supabaseUrl, env.serviceRoleKey, CLIENT_OPTIONS);
  return admin;
}

/** A client with no session at all (Postgres role `anon`). */
export function anonClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.anonKey, CLIENT_OPTIONS);
}

export interface Citizen {
  client: SupabaseClient;
  userId: string;
  accessToken: string;
}

/**
 * A fresh anonymous citizen (02 §7.1). Each test uses its own, so the per-user rate limit never
 * leaks between tests. Local Auth allows 100 anonymous sign-ins per hour per IP (config.toml).
 */
export async function newCitizen(): Promise<Citizen> {
  const client = createClient(env.supabaseUrl, env.anonKey, CLIENT_OPTIONS);
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session || !data.user) {
    throw new Error(`anonymous sign-in failed: ${error?.message ?? "no session"} (is enable_anonymous_sign_ins on?)`);
  }
  return { client, userId: data.user.id, accessToken: data.session.access_token };
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** A valid 1×1 baseline JPEG (286 bytes, no EXIF). */
export const TINY_JPEG: Uint8Array = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/" +
      "2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDAREAAhEBAxEB/8QA" +
      "FAABAAAAAAAAAAAAAAAAAAAABv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAGB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAM" +
      "AwEAAhEDEQA/ADQwqT//2Q==",
    "base64",
  ),
);

/** `{uid}/{uuid}.jpg` (02 §10.2). */
export function photoPath(uid: string): string {
  return `${uid}/${randomUUID()}.jpg`;
}

/** Raw upload; returns the Storage error (or null) so RLS tests can expect a failure. */
export async function tryUpload(
  client: SupabaseClient,
  bucket: StorageBucket,
  path: string,
  opts: { upsert?: boolean } = {},
): Promise<Error | null> {
  const { error } = await client.storage
    .from(bucket)
    .upload(path, TINY_JPEG, { contentType: "image/jpeg", upsert: opts.upsert ?? false });
  return error;
}

/** Uploads a fresh photo into the citizen's own `report-photos` folder; returns its path. */
export async function uploadPhoto(citizen: Citizen): Promise<string> {
  const path = photoPath(citizen.userId);
  const error = await tryUpload(citizen.client, STORAGE_BUCKETS.reportPhotos, path);
  if (error) throw new Error(`photo upload to ${path} failed: ${error.message}`);
  return path;
}

/** What the API must return as `image_url`: the same-origin photo route (src/lib/api/storage.ts `photoUrl`). */
export function photoRoutePath(kind: "report" | "evidence", id: string): string {
  return `/api/photos/${kind}/${id}`;
}

/** Old-style public Storage URL. Both buckets are private now (02 §10.2), so it must not serve the photo. */
export function storagePublicUrl(bucket: StorageBucket, path: string): string {
  return `${env.supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

export interface PhotoResult {
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  bytes: Uint8Array;
  text: string;
}

/** GETs a photo route path (e.g. an `image_url` from a response) from the app. */
export async function fetchPhoto(path: string, opts: { token?: string } = {}): Promise<PhotoResult> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${env.appUrl}${path}`, { headers, signal: AbortSignal.timeout(60_000) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    cacheControl: res.headers.get("cache-control"),
    bytes,
    text: new TextDecoder().decode(bytes.slice(0, 500)),
  };
}

/** Cache-Control of a photo anyone may see (photo route, 02 §10.3). */
export const PUBLIC_PHOTO_CACHE = "public, max-age=300, s-maxage=300";
/** Cache-Control of a REJECTED issue's photo, served only to its reporters and authorities. */
export const VIEWER_ONLY_PHOTO_CACHE = "private, no-store";

/**
 * Asserts `path` serves exactly the uploaded test JPEG (TINY_JPEG) with the expected cache header
 * (default: the public one).
 */
export async function expectPhoto(path: string, opts: { token?: string; cacheControl?: string } = {}): Promise<void> {
  const photo = await fetchPhoto(path, opts);
  assert.equal(photo.status, 200, `GET ${path}: expected 200, got ${photo.status}: ${photo.text}`);
  assert.equal(photo.contentType, "image/jpeg");
  assert.equal(photo.cacheControl, opts.cacheControl ?? PUBLIC_PHOTO_CACHE);
  assert.deepEqual(photo.bytes, TINY_JPEG, `GET ${path} did not return the uploaded bytes`);
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * A random point in northern Mumbai, ≥ 2 km from DEMO_SPOT and from the City Pulse scenario,
 * so test rows never disturb the judge demo (02 §14) or the seeded hotspot.
 */
export function randomMumbaiPoint(): LatLng {
  for (;;) {
    const p = {
      lat: Number((19.09 + randomInt(0, 160_000) / 1_000_000).toFixed(6)), // 19.09 … 19.25
      lng: Number((72.84 + randomInt(0, 110_000) / 1_000_000).toFixed(6)), // 72.84 … 72.95
    };
    if (distanceM(p, DEMO_SPOT) > 2000 && distanceM(p, CITY_PULSE_DEMO_CENTER) > 2000) return p;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * A fake client IP from 198.18.0.0/15 (benchmarking range), unique per test process. The route
 * hashes the FIRST x-forwarded-for entry (phase-1 contract), so the per-IP limit (100/h) that
 * these tests consume is this fake IP's, not the developer's real one. Behind Vercel the
 * platform sets the header.
 */
export function randomFakeIp(): string {
  return `198.${randomInt(18, 20)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

export const RUN_IP = randomFakeIp();

export interface ApiOptions {
  /** Supabase access token → `Authorization: Bearer` (src/lib/api/auth.ts). */
  token?: string;
  /** JSON-encoded unless it is already a string. */
  body?: unknown;
  headers?: Record<string, string>;
  /** x-forwarded-for value; defaults to RUN_IP. `null` sends none. */
  ip?: string | null;
}

export interface ApiResult {
  status: number;
  json: unknown;
  text: string;
}

export async function api(method: string, path: string, opts: ApiOptions = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { accept: "application/json", ...opts.headers };
  const ip = opts.ip === undefined ? RUN_IP : opts.ip;
  if (ip !== null) headers["x-forwarded-for"] = ip;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${env.appUrl}${path}`, { method, headers, body, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON answer; assertions below will show `text`
  }
  return { status: res.status, json, text };
}

/** Asserts a success envelope with one of `statuses` and returns `data` parsed by `schema`. */
export function expectOk<S extends z.ZodType>(res: ApiResult, schema: S, statuses: number[] = [200]): z.output<S> {
  assert.ok(statuses.includes(res.status), `expected HTTP ${statuses.join("/")}, got ${res.status}: ${res.text}`);
  // The envelope schema (02 §13) with `data` validated against the route's contract.
  const envelope = apiEnvelopeSchema(schema).safeParse(res.json);
  assert.ok(envelope.success, `response does not match the contract: ${envelope.error?.message}\n${res.text}`);
  const { data, error } = res.json as { data: unknown; error: unknown };
  assert.equal(error, null, res.text);
  // Re-parse `data` alone for a precisely typed (and transformed) result.
  return schema.parse(data) as z.output<S>;
}

/** Asserts an error envelope with `code` and the HTTP status for it; returns the message. */
export function expectError(res: ApiResult, status: number, code: ErrorCode): string {
  assert.equal(res.status, status, `expected HTTP ${status} ${code}, got ${res.status}: ${res.text}`);
  const envelope = res.json as { data?: unknown; error?: unknown } | null;
  assert.equal(envelope?.data, null, res.text);
  const error = apiErrorSchema.parse(envelope?.error);
  assert.equal(error.code, code, res.text);
  assert.ok(error.message.trim().length > 0, "error message must not be empty");
  return error.message;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** A valid POST /api/reports body. Category OTHER + a marker description identify test rows. */
export function reportBody(imagePath: string, overrides: Partial<CreateReportBodyInput> = {}): CreateReportBodyInput {
  const at = randomMumbaiPoint();
  return {
    category: "OTHER" satisfies Category,
    citizen_severity: null,
    description: `[integration test] ${randomUUID().slice(0, 8)}`,
    image_path: imagePath,
    lat: at.lat,
    lng: at.lng,
    ...overrides,
  };
}

export interface CreatedReport {
  res: ApiResult;
  body: CreateReportBodyInput;
}

/** Uploads a photo and POSTs /api/reports as the citizen (no assertions). */
export async function postReport(
  citizen: Citizen,
  opts: { ip?: string | null; body?: Partial<CreateReportBodyInput> } = {},
): Promise<CreatedReport> {
  const body = reportBody(await uploadPhoto(citizen), opts.body);
  const res = await api("POST", "/api/reports", { token: citizen.accessToken, body, ip: opts.ip });
  return { res, body };
}

/** postReport + asserts it was created (201, or 200). */
export async function createReport(
  citizen: Citizen,
  opts: { ip?: string | null; body?: Partial<CreateReportBodyInput> } = {},
): Promise<{ issueId: string; reportId: string; body: CreateReportBodyInput }> {
  const { res, body } = await postReport(citizen, opts);
  const data = expectOk(res, createReportResponseSchema, [201, 200]);
  assert.equal(data.created_new_issue, true);
  return { issueId: data.issue_id, reportId: data.report_id, body };
}

/** Rows in `reports` for a user (service role). */
export async function countReportsBy(userId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("reporter_user_id", userId);
  if (error) throw new Error(`count reports failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Collects every key and string value in a JSON tree, skipping the values of `skipKeys`.
 * Used for privacy checks (02 §7.4, 06 rule 22).
 */
export function jsonStrings(value: unknown, skipKeys: readonly string[] = []): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        out.push(k);
        if (!skipKeys.includes(k)) walk(child);
      }
    }
  };
  walk(value);
  return out;
}

export const PRIVATE_KEYS = ["reporter_user_id", "reporter_ip_hash", "actor_user_id", "uploaded_by", "image_path"] as const;

// ---------------------------------------------------------------------------
// Geometry: metre offsets
// ---------------------------------------------------------------------------

// WGS84 ellipsoid: PostGIS geography distances (ST_DWithin / ST_Distance) use the spheroid.
const WGS84_A = 6_378_137;
const WGS84_E2 = 0.006_694_379_990_14;

/**
 * The point `metersNorth` / `metersEast` away from (lat, lng), using the WGS84 meridional and
 * prime-vertical radii of curvature at that latitude — accurate to millimetres over the few hundred
 * metres the duplicate tests use (02 §3.2 radii), so `distance_m` can be checked to ±0.5 m.
 */
export function offsetPoint(lat: number, lng: number, metersNorth: number, metersEast: number): LatLng {
  const phi = (lat * Math.PI) / 180;
  const w = 1 - WGS84_E2 * Math.sin(phi) ** 2;
  const meridional = (WGS84_A * (1 - WGS84_E2)) / w ** 1.5;
  const primeVertical = WGS84_A / Math.sqrt(w);
  return {
    lat: lat + (metersNorth / meridional) * (180 / Math.PI),
    lng: lng + (metersEast / (primeVertical * Math.cos(phi))) * (180 / Math.PI),
  };
}

// ---------------------------------------------------------------------------
// Fresh issues and the reads that show them
// ---------------------------------------------------------------------------

export interface FreshIssue {
  /** The reporter (a fresh anonymous citizen unless one was passed in). */
  citizen: Citizen;
  issueId: string;
  reportId: string;
  body: CreateReportBodyInput;
  point: LatLng;
}

/**
 * A new issue created through POST /api/reports, by default as a fresh citizen at a random point
 * in northern Mumbai (randomMumbaiPoint: ≥ 2 km from DEMO_SPOT and the City Pulse scenario).
 * Pass `body` to pick the category / point; pass `citizen` to reuse one (5 reports/hour each).
 */
export async function newIssue(
  opts: { citizen?: Citizen; body?: Partial<CreateReportBodyInput>; ip?: string | null } = {},
): Promise<FreshIssue> {
  const citizen = opts.citizen ?? (await newCitizen());
  const { issueId, reportId, body } = await createReport(citizen, { body: opts.body, ip: opts.ip });
  return { citizen, issueId, reportId, body, point: { lat: body.lat, lng: body.lng } };
}

/** GET /api/issues/:id (anonymous unless a token is given), asserting 200 + the contract. */
export async function getIssue(issueId: string, opts: { token?: string } = {}): Promise<IssueDetail> {
  return expectOk(await api("GET", `/api/issues/${issueId}`, { token: opts.token, ip: null }), issueDetailResponseSchema);
}

/** GET /api/my-reports as the citizen, asserting 200 + the contract. */
export async function getMyReports(citizen: { accessToken: string }): Promise<MyReportsResponse> {
  return expectOk(await api("GET", "/api/my-reports", { token: citizen.accessToken }), myReportsResponseSchema);
}

/**
 * Asserts the timeline's event types, oldest first. Each inner array is one write: events written
 * by the same transaction share `created_at`, and the timeline then orders them by id (random),
 * so their order within a group is not asserted. Also checks `created_at` never goes backwards
 * and, when given, each group's actor kind.
 */
export function expectTimeline(
  timeline: readonly TimelineEvent[],
  groups: readonly (readonly EventType[])[],
  actors?: readonly TimelineActor[],
): void {
  const shown = JSON.stringify(timeline.map((e) => [e.event_type, e.actor]));
  assert.equal(timeline.length, groups.flat().length, `timeline ${shown}`);
  let i = 0;
  groups.forEach((group, g) => {
    const events = timeline.slice(i, i + group.length);
    assert.deepEqual(events.map((e) => e.event_type).sort(), [...group].sort(), `timeline group ${g} in ${shown}`);
    const actor = actors?.[g];
    if (actor) for (const e of events) assert.equal(e.actor, actor, `actor of ${e.event_type} in ${shown}`);
    i += group.length;
  });
  for (let k = 1; k < timeline.length; k++) {
    assert.ok(
      Date.parse(timeline[k - 1]!.created_at) <= Date.parse(timeline[k]!.created_at),
      `timeline is not oldest-first: ${shown}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Authority (02 §7.2): the account `npm run demo:reset` creates
// ---------------------------------------------------------------------------

const AUTHORITY_ENV = ["AUTHORITY_EMAIL", "AUTHORITY_PASSWORD"] as const;

/**
 * Why tests that act as the authority are skipped: the stack's skip reason, else missing
 * AUTHORITY_EMAIL / AUTHORITY_PASSWORD. With INTEGRATION_REQUIRED=1 they run anyway, and
 * `authority()` fails with the missing-variable message.
 */
export const authoritySkipReason: string | false =
  skipReason ||
  (AUTHORITY_ENV.some((n) => !process.env[n]?.trim()) && process.env.INTEGRATION_REQUIRED !== "1"
    ? `authority account not configured: set ${AUTHORITY_ENV.join(" and ")} (the values \`npm run demo:reset -- --local\` used)`
    : false);

/** testOptions() for tests that need the authority account. */
export function authorityTestOptions(extra: { timeout?: number; skip?: string | false } = {}): {
  skip: string | false;
  timeout: number;
} {
  return testOptions({ ...extra, skip: authoritySkipReason || extra.skip || false });
}

export type Authority = Citizen;

async function signInAuthority(): Promise<Authority> {
  const missing = AUTHORITY_ENV.filter((n) => !process.env[n]?.trim());
  if (missing.length > 0) throw new Error(`missing ${missing.join(", ")} (see tests/integration/README.md)`);
  const client = createClient(env.supabaseUrl, env.anonKey, CLIENT_OPTIONS);
  const { data, error } = await client.auth.signInWithPassword({
    email: env.authorityEmail,
    password: env.authorityPassword,
  });
  if (error || !data.session || !data.user) {
    throw new Error(
      `authority sign-in as ${env.authorityEmail} failed: ${error?.message ?? "no session"} — ` +
        "run `npm run demo:reset -- --local` with the same AUTHORITY_EMAIL / AUTHORITY_PASSWORD",
    );
  }
  const { data: row, error: rowError } = await adminClient()
    .from("users")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (rowError) throw new Error(`users lookup failed: ${rowError.message}`);
  if ((row as { role?: string } | null)?.role !== "AUTHORITY") {
    throw new Error(`${env.authorityEmail} has no AUTHORITY users row — run \`npm run demo:reset -- --local\``);
  }
  return { client, userId: data.user.id, accessToken: data.session.access_token };
}

let authoritySession: Promise<Authority> | undefined;

/** The authority account, signed in once per test file (email/password, no persisted session). */
export function authority(): Promise<Authority> {
  authoritySession ??= signInAuthority();
  return authoritySession;
}

/** Uploads a fresh photo into the authority's own `resolution-photos` folder; returns its path. */
export async function uploadResolutionPhoto(auth: Authority): Promise<string> {
  const path = photoPath(auth.userId);
  const error = await tryUpload(auth.client, STORAGE_BUCKETS.resolutionPhotos, path);
  if (error) throw new Error(`resolution photo upload to ${path} failed: ${error.message}`);
  return path;
}

/** supabase/seed.sql departments (fixed ids), as GET /api/departments returns them: by name. */
export const SEED_DEPARTMENTS = [
  { id: "5eedde00-0000-4000-8000-000000000001", name: "Roads", sla_hours: 72, default_categories: ["POTHOLE", "FOOTPATH", "PUBLIC_PROPERTY"] },
  { id: "5eedde00-0000-4000-8000-000000000003", name: "Solid Waste", sla_hours: 72, default_categories: ["GARBAGE"] },
  { id: "5eedde00-0000-4000-8000-000000000005", name: "Storm Water Drainage", sla_hours: 72, default_categories: ["DRAINAGE", "WATERLOGGING"] },
  { id: "5eedde00-0000-4000-8000-000000000002", name: "Street Lighting", sla_hours: 72, default_categories: ["STREETLIGHT"] },
  { id: "5eedde00-0000-4000-8000-000000000004", name: "Water Supply", sla_hours: 72, default_categories: ["WATER_LEAK"] },
] as const satisfies readonly { id: string; name: string; sla_hours: number; default_categories: readonly Category[] }[];

export const ROADS = SEED_DEPARTMENTS[0];

/** POST /api/issues/:id/assign as the authority, asserting 200. */
export async function assignIssue(auth: Authority, issueId: string, departmentId: string): Promise<AssignIssueResponse> {
  const res = await api("POST", `/api/issues/${issueId}/assign`, {
    token: auth.accessToken,
    body: { department_id: departmentId },
  });
  return expectOk(res, assignIssueResponseSchema);
}

/** PATCH /api/issues/:id/status → IN_PROGRESS ("Start work"), asserting 200. */
export async function startWork(auth: Authority, issueId: string): Promise<TransitionIssueResponse> {
  const res = await api("PATCH", `/api/issues/${issueId}/status`, {
    token: auth.accessToken,
    body: { to_status: "IN_PROGRESS" },
  });
  return expectOk(res, transitionIssueResponseSchema);
}

/** Uploads an after-photo and POSTs /api/issues/:id/resolution, asserting 200. */
export async function resolveIssue(
  auth: Authority,
  issueId: string,
  note: string | null = "[integration test] fixed",
): Promise<ResolveIssueResponse> {
  const res = await api("POST", `/api/issues/${issueId}/resolution`, {
    token: auth.accessToken,
    body: { image_path: await uploadResolutionPhoto(auth), note },
  });
  return expectOk(res, resolveIssueResponseSchema);
}

/** REPORTED → ASSIGNED (Roads by default) → IN_PROGRESS → RESOLVED. */
export async function assignStartResolve(
  auth: Authority,
  issueId: string,
  departmentId: string = ROADS.id,
): Promise<ResolveIssueResponse> {
  await assignIssue(auth, issueId, departmentId);
  await startWork(auth, issueId);
  return resolveIssue(auth, issueId);
}

// ---------------------------------------------------------------------------
// Authority queue (Phase 4: recommended priority, 02 §5)
// ---------------------------------------------------------------------------

/**
 * Factors come back rounded to 2 decimals and the score is computed in SQL from the UNROUNDED
 * factors, so Σ weights × (rounded factors) can differ from `score` by up to ~0.01. ±0.02 also
 * covers age drift between the SQL `now()` and the assertion.
 */
export const SCORE_TOLERANCE = 0.02;
/** A factor recomputed here from the row's own inputs (support, recurrence) vs the rounded value. */
const FACTOR_TOLERANCE = 0.01;
/** Age is recomputed from `created_at` and this machine's clock: allow ~30 min of skew / latency. */
const AGE_TOLERANCE = (0.5 / PRIORITY_CONFIG.age_full_hours) * PRIORITY_CONFIG.factor_max;

/** GET /api/authority/queue as the authority, asserting 200 + the contract. */
export async function getQueue(auth: Authority, query = ""): Promise<AuthorityQueueRow[]> {
  return expectOk(await api("GET", `/api/authority/queue${query}`, { token: auth.accessToken }), authorityQueueResponseSchema);
}

/** Σ weights × factors (02 §5.9) from the row's (rounded) factors. */
export function weightedScore(f: PriorityFactors): number {
  const w = PRIORITY_CONFIG.weights;
  return (
    w.severity * f.severity +
    w.support * f.support +
    w.age * f.age +
    w.location_risk * f.location_risk +
    w.recurrence * f.recurrence
  );
}

export function near(actual: number, expected: number, tolerance: number, what: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance + 1e-9,
    `${what}: ${actual}, expected ${expected} ± ${tolerance}`,
  );
}

/**
 * Phase 4: the recommendation is always present and self-consistent (02 §5.4–§5.9):
 * every factor in 0..factor_max; severity = severity_values[effective_severity]; support and
 * recurrence follow from distinct_reporter_count / recurrence_count; age from created_at;
 * score = Σ weights × factors; label = priorityLabel(score) (either side of a threshold within
 * rounding). Call it right after the GET (the age check uses this machine's clock).
 */
export function expectQueueRecommendation(row: AuthorityQueueRow): asserts row is AuthorityQueueRow & {
  factors: PriorityFactors;
  score: number;
  label: Level;
  recurrence_count: number;
} {
  const c = PRIORITY_CONFIG;
  const id = `(${row.id})`;
  assert.ok(row.factors !== null, `factors must be present ${id}`);
  assert.ok(row.score !== null, `score must be present ${id}`);
  assert.ok(row.label !== null, `label must be present ${id}`);
  assert.ok(row.recurrence_count !== null && Number.isInteger(row.recurrence_count), `recurrence_count must be an integer ${id}`);
  const f = row.factors;
  for (const [k, v] of Object.entries(f)) {
    assert.ok(Number.isFinite(v) && v >= 0 && v <= c.factor_max, `factor ${k} = ${v} outside 0..${c.factor_max} ${id}`);
  }

  // §5.4 severity: from the effective severity; DEFAULT only ever means default_severity.
  assert.equal(f.severity, c.severity_values[row.effective_severity], `severity factor vs ${row.effective_severity} ${id}`);
  if (row.severity_source === "DEFAULT") assert.equal(row.effective_severity, c.default_severity, `DEFAULT severity ${id}`);
  // §5.5 support from distinct reporters (≥ 1 for any issue with a report).
  near(f.support, Math.min(c.factor_max, c.support_multiplier * Math.log2(1 + row.distinct_reporter_count)), FACTOR_TOLERANCE, `support ${id}`);
  // §5.6 age from created_at.
  const hours = (Date.now() - Date.parse(row.created_at)) / 3_600_000;
  near(f.age, Math.min(c.factor_max, Math.max(0, (hours / c.age_full_hours) * c.factor_max)), AGE_TOLERANCE, `age ${id}`);
  // §5.8 recurrence from recurrence_count.
  near(f.recurrence, Math.min(c.factor_max, c.recurrence_points_per_issue * row.recurrence_count), FACTOR_TOLERANCE, `recurrence ${id}`);

  // §5.9 score and label.
  near(row.score, weightedScore(f), SCORE_TOLERANCE, `score vs Σ weights × factors ${id}`);
  const labels = new Set([priorityLabel(row.score - 0.01), priorityLabel(row.score), priorityLabel(row.score + 0.01)]);
  assert.ok(labels.has(row.label), `label ${row.label} for score ${row.score} ${id}`);
}

/**
 * Phase 4 order (phase-4 contract): the returned (rounded) score descending, then created_at
 * ascending (then id).
 */
export function expectQueueOrder(rows: readonly AuthorityQueueRow[]): void {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    assert.ok(a.score !== null && b.score !== null, "queue rows without a score");
    const shown = `${a.id} ${a.score}/${a.created_at} before ${b.id} ${b.score}/${b.created_at}`;
    assert.ok(a.score >= b.score, `queue not sorted by score at ${i}: ${shown}`);
    if (a.score === b.score) {
      assert.ok(Date.parse(a.created_at) <= Date.parse(b.created_at), `equal scores not oldest first at ${i}: ${shown}`);
    }
  }
}

/**
 * Checks the rows against the database (service role): severity_source / effective_severity
 * follow authority → citizen → default (02 §5.4), and location_risk is the default or a seeded
 * zone's risk_value (§5.7).
 */
export async function expectQueueInputs(rows: readonly AuthorityQueueRow[]): Promise<void> {
  const { data: zones, error: zoneError } = await adminClient().from("risk_zones").select("risk_value");
  if (zoneError) throw new Error(`risk_zones lookup failed: ${zoneError.message}`);
  const riskValues = new Set<number>([PRIORITY_CONFIG.default_location_risk, ...(zones as { risk_value: number }[]).map((z) => z.risk_value)]);

  const severities = new Map<string, { authority_severity: Level | null; citizen_severity: Level | null }>();
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((r) => r.id);
    const { data, error } = await adminClient().from("issues").select("id, authority_severity, citizen_severity").in("id", ids);
    if (error) throw new Error(`issues lookup failed: ${error.message}`);
    for (const r of data as { id: string; authority_severity: Level | null; citizen_severity: Level | null }[]) {
      severities.set(r.id, r);
    }
  }

  for (const row of rows) {
    const s = severities.get(row.id);
    assert.ok(s, `queue row ${row.id} is not in issues`);
    const [level, source]: [Level, SeveritySource] = s.authority_severity
      ? [s.authority_severity, "AUTHORITY"]
      : s.citizen_severity
        ? [s.citizen_severity, "CITIZEN"]
        : [PRIORITY_CONFIG.default_severity, "DEFAULT"];
    assert.equal(row.severity_source, source, `severity_source of ${row.id}`);
    assert.equal(row.effective_severity, level, `effective_severity of ${row.id}`);
    assert.ok(row.factors && riskValues.has(row.factors.location_risk), `location_risk ${row.factors?.location_risk} of ${row.id} is no zone's value`);
  }
}

// ---------------------------------------------------------------------------
// City Pulse (Phase 5, 02 §6; phase-5 contract)
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

/** GET /api/hotspots (public, no session), asserting 200 + the contract. */
export async function getHotspots(): Promise<Hotspot[]> {
  return expectOk(await api("GET", "/api/hotspots", { ip: null }), hotspotsResponseSchema);
}

/** POST /api/hotspots/regenerate as the authority, asserting 200 + the contract. */
export async function regenerateHotspots(auth: Authority): Promise<RegenerateHotspotsResponse> {
  return expectOk(
    await api("POST", "/api/hotspots/regenerate", { token: auth.accessToken }),
    regenerateHotspotsResponseSchema,
  );
}

/** Ray casting on the outer ring, planar in lng/lat (fine over the few hundred metres here). */
export function polygonContains(polygon: GeoJsonPolygon, p: LatLng): boolean {
  const ring = polygon.coordinates[0] ?? [];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Smallest distance from `p` to any vertex of the polygon's outer ring, in metres. */
export function polygonDistanceM(polygon: GeoJsonPolygon, p: LatLng): number {
  return Math.min(...(polygon.coordinates[0] ?? []).map(([lng, lat]) => distanceM({ lat, lng }, p)));
}

/** Unrounded 02 §6.4 numbers for a cluster with these counts. */
export function cityPulseTrend(current: number, baseline: number): { expected: number; trend: number } {
  const c = CITY_PULSE_CONFIG;
  const expected = baseline / c.baseline_divisor;
  return { expected, trend: ((current - expected) / Math.max(expected, c.expected_floor)) * 100 };
}

/** 02 §6.5: severity from the (unrounded) trend; CRITICAL needs critical_min_current_count, else HIGH. */
export function cityPulseSeverity(current: number, trend: number): Level {
  const c = CITY_PULSE_CONFIG;
  const t = c.trend_thresholds_percent;
  if (trend >= t.CRITICAL) return current >= c.critical_min_current_count ? "CRITICAL" : "HIGH";
  if (trend >= t.HIGH) return "HIGH";
  if (trend >= t.MEDIUM) return "MEDIUM";
  return "LOW";
}

/**
 * 02 §6.7 in the phase-5 contract's exact format, e.g.
 * "6 DRAINAGE issues within ~300 m in the last 2 h (expected 0.3) — trend +566%."
 * The sign is always shown and the percent truncated toward zero; a trend in (-1, 0) truncates to
 * 0, whose sign the contract leaves open, so both spellings are returned then.
 */
export function cityPulseExplanations(category: Category, current: number, baseline: number): string[] {
  const c = CITY_PULSE_CONFIG;
  const { expected, trend } = cityPulseTrend(current, baseline);
  const whole = Math.abs(Math.trunc(trend));
  const head = `${current} ${category} issues within ~${c.cluster_eps_m} m in the last ${c.current_window_hours} h`;
  const text = (sign: string) => `${head} (expected ${expected.toFixed(1)}) — trend ${sign}${whole}%.`;
  if (whole === 0) return [text("+"), text("-")];
  return [text(trend < 0 ? "-" : "+")];
}

/**
 * One hotspot is self-consistent (02 §6.4–§6.7, phase-5 contract): an active cluster
 * (current ≥ min_current_count), expected = baseline / divisor (rounded 2), trend from the counts
 * (rounded 1), severity from the trend, the exact explanation, an 8 h window ending at
 * generated_at, a closed Polygon ring, and unique member ids (at most current + baseline: REJECTED
 * members are hidden).
 */
export function expectHotspotConsistent(h: Hotspot): void {
  const c = CITY_PULSE_CONFIG;
  const id = `(hotspot ${h.id}, ${h.category})`;
  assert.ok(h.current_issue_count >= c.min_current_count, `current_issue_count ${h.current_issue_count} < ${c.min_current_count} ${id}`);
  const { expected, trend } = cityPulseTrend(h.current_issue_count, h.baseline_issue_count);
  near(h.expected_current_count, expected, 0.005, `expected_current_count ${id}`);
  near(h.trend_percent, trend, 0.05, `trend_percent ${id}`);
  assert.equal(h.severity, cityPulseSeverity(h.current_issue_count, trend), `severity for trend ${trend} ${id}`);
  const explanations = cityPulseExplanations(h.category, h.current_issue_count, h.baseline_issue_count);
  assert.ok(explanations.includes(h.explanation), `explanation ${JSON.stringify(h.explanation)}, expected ${JSON.stringify(explanations[0])} ${id}`);

  const end = Date.parse(h.window_end);
  assert.equal(end, Date.parse(h.generated_at), `window_end must equal generated_at ${id}`);
  assert.equal(end - Date.parse(h.window_start), c.input_window_hours * HOUR_MS, `window must span ${c.input_window_hours} h ${id}`);

  for (const ring of h.geometry.coordinates) {
    assert.deepEqual(ring[0], ring[ring.length - 1], `polygon ring not closed ${id}`);
  }
  assert.equal(new Set(h.member_issue_ids).size, h.member_issue_ids.length, `duplicate member ids ${id}`);
  assert.ok(
    h.member_issue_ids.length <= h.current_issue_count + h.baseline_issue_count,
    `${h.member_issue_ids.length} members for ${h.current_issue_count} + ${h.baseline_issue_count} issues ${id}`,
  );
}

/**
 * A whole active set (GET /api/hotspots or a regenerate result): every hotspot consistent, one
 * generation (a single distinct generated_at), ordered severity CRITICAL → LOW, then
 * current_issue_count desc, then id. Returns that generated_at (null for an empty set).
 */
export function expectHotspotSet(list: readonly Hotspot[]): string | null {
  list.forEach(expectHotspotConsistent);
  const generations = new Set(list.map((h) => Date.parse(h.generated_at)));
  assert.ok(generations.size <= 1, `active hotspots from ${generations.size} generations: ${JSON.stringify(list.map((h) => h.generated_at))}`);
  const rank = (h: Hotspot) => LEVELS.indexOf(h.severity);
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1]!;
    const b = list[i]!;
    const shown = `${a.id} ${a.severity}/${a.current_issue_count} before ${b.id} ${b.severity}/${b.current_issue_count}`;
    assert.ok(
      rank(a) > rank(b) ||
        (rank(a) === rank(b) &&
          (a.current_issue_count > b.current_issue_count || (a.current_issue_count === b.current_issue_count && a.id < b.id))),
      `hotspots out of order at ${i}: ${shown}`,
    );
  }
  return list[0]?.generated_at ?? null;
}

/** Calls `probe` every `intervalMs` until it returns a value or `timeoutMs` passes. */
export async function pollUntil<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined || Date.now() >= deadline) return value;
    await sleep(intervalMs);
  }
}

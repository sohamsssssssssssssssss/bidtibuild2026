# API integration tests (Phases 1–5)

> **Unit tests** (no stack needed) live in `tests/unit/` and run with `npm run test:unit`:
> `priority.test.ts` checks `priorityLabel` boundaries, reproduces the 02 §5.10 calibration rows
> from `PRIORITY_CONFIG` with a test-only reference implementation of the 02 §5 formula (SQL owns
> the real math), and checks the status-transition helpers in `src/config/civic.ts`.

These tests call the real API routes and the real local Supabase (02 §15). They need the full
local stack. If the stack isn't configured or reachable, every test is **skipped** with the
reason, and the run still exits 0. Set `INTEGRATION_REQUIRED=1` (e.g. in CI) to make that a failure.

## Run

```bash
npx supabase start                  # Docker required
npx supabase status -o env          # copy API_URL / ANON_KEY / SERVICE_ROLE_KEY into .env.local
# .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#             IP_HASH_SALT (any string), AUTHORITY_EMAIL, AUTHORITY_PASSWORD
npm run demo:reset -- --local       # migrations + seed + authority + City Pulse
npm run dev                         # in another terminal
npm run test:integration            # within ~90 min of demo:reset, or the seeded City Pulse test skips
RUN_IP_LIMIT_TEST=1 npm run test:integration   # also run the per-IP limit test (opt-in)
RUN_DEMO_SPOT_TEST=1 npm run test:integration  # also run the DEMO_SPOT gate rehearsal (opt-in)
npm run demo:reset -- --local                  # REQUIRED after RUN_DEMO_SPOT_TEST, before a real demo
```

| Variable | Default | Notes |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | where `npm run dev` listens |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from `.env.local` / `.env` | required, or the tests skip |
| `IP_HASH_SALT` | from `.env.local` | optional for the tests; if set, the stored `reporter_ip_hash` is checked exactly |
| `AUTHORITY_EMAIL`, `AUTHORITY_PASSWORD` | from `.env.local` / `.env` | the account `demo:reset` created; without them every test that acts as the authority is skipped with that reason (with `INTEGRATION_REQUIRED=1` they fail instead) |
| `RUN_IP_LIMIT_TEST=1` | off | enables `ip-limit.test.ts` |
| `RUN_DEMO_SPOT_TEST=1` | off | enables `demo-spot.test.ts` (writes at `DEMO_SPOT`; run `demo:reset` afterwards) |
| `INTEGRATION_REQUIRED=1` | off | fail instead of skip when the stack is missing |

The stack check needs the Supabase URL and `APP_URL` to accept a TCP connection within 2 s, and
`GET /api/issues?bbox=…` to answer 200.

## Files

- `helpers.ts`: env loading, the stack check and skip reason, `newCitizen()` (a fresh anonymous
  session), `uploadPhoto()` (a hard-coded 1×1 JPEG at `{uid}/{uuid}.jpg`), `expectPhoto()`
  (GETs a `/api/photos/...` path and checks the JPEG bytes and cache header), `api()`,
  `adminClient()`, and envelope assertions validated against `src/contracts`. Phase 2/3 additions:
  `authority()` (signs in once per file with `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD`, checks the
  `users` row), `authorityTestOptions()` (skip reason when those are missing),
  `uploadResolutionPhoto()` (`resolution-photos/{uid}/{uuid}.jpg`), `newIssue()` (a fresh citizen's
  issue at a random point), `offsetPoint(lat, lng, metersNorth, metersEast)` (WGS84, mm-accurate),
  `getIssue()` / `getMyReports()`, `expectTimeline()`, `SEED_DEPARTMENTS`, and the workflow steps
  `assignIssue()` / `startWork()` / `resolveIssue()` / `assignStartResolve()`. Phase 4 additions:
  `getQueue()`, `expectQueueRecommendation()` (factors present and in 0..100, severity / support /
  age / recurrence consistent with the row, score = Σ weights × factors ± `SCORE_TOLERANCE` (0.02,
  factors are rounded), label = `priorityLabel(score)` allowing either side of a threshold within
  0.01), `expectQueueOrder()` (score desc, then `created_at` asc), `expectQueueInputs()` (service
  role: severity source follows authority → citizen → default; location risk is the default or a
  seeded zone's value). Phase 5 additions: `getHotspots()` / `regenerateHotspots()`,
  `expectHotspotConsistent()` (one hotspot against 02 §6.4–§6.7: current ≥ 4, expected =
  baseline / 3, trend, severity incl. the HIGH cap, the exact explanation text, an 8 h window ending
  at `generated_at`, a closed Polygon), `expectHotspotSet()` (all of those, one `generated_at`,
  ordered CRITICAL → LOW then current count desc then id), `polygonContains()` /
  `polygonDistanceM()`, `cityPulseTrend()` / `cityPulseSeverity()` / `cityPulseExplanations()`, and
  `pollUntil()`.
- `register.ts`: a resolve hook (`node --import`) that lets Node's type stripping load the
  extensionless imports inside `src/contracts`.
- `reports.test.ts`: create → detail / map / My Reports / photo route, validation and auth errors, and the per-user rate limit.
- `rls.test.ts`: direct Supabase access as an anonymous citizen: table writes, reads, RPCs and Storage.
- `ip-limit.test.ts`: the per-IP rate limit (opt-in).
- `authority.test.ts` (Phases 2 + 4): 401/403 on every authority route; the seed's departments;
  priority + severity (events only on change), assign / reassign with SLA, start, resolve with
  evidence, the timeline and My Reports; disallowed transitions (409), REOPENED (501); rejection
  (note required, hidden publicly, still visible to the reporter, `private, no-store` photo); the
  queue (open statuses only, filters, the recommendation on every row, sorted by score; a fresh
  citizen-LOW issue scores 18.75 LOW, and 36.25 MEDIUM once the authority sets severity HIGH —
  final priority never changes it); and the 02 §5.10 "generic new report" calibration row
  (27.50 MEDIUM). If recommended priority is ever cut (05 §4), the queue returns to v1 (nulls,
  final priority then age): change `expectQueueRecommendation()` / `expectQueueOrder()` in helpers.ts.
- `duplicates.test.ts` (Phase 3): duplicate candidates (radius of the new report's category,
  EXACT vs FAMILY, ranking, photo), supporting reports, support/merge on closed issues, authority
  merge (moves reports, no chains, My Reports follow), and the judge-demo path (03 §6 steps 2–8)
  at a random spot, including the two-reporter breakdown (support ≈ 39.62).
- `demo-spot.test.ts` (Phase 4 gate, **opt-in** with `RUN_DEMO_SPOT_TEST=1`): the judge demo AT
  `DEMO_SPOT` with the exact 02 §5.10 numbers — A's pothole (citizen HIGH) shows severity 75,
  support 25, location risk 80, recurrence 0 → 47.25 HIGH; B (10 m away) gets it as the first
  candidate and attaches → support ≈ 39.62 → 50.17 HIGH (both ± 0.02 for age drift); then final
  priority HIGH, Roads, start, resolve, and A sees RESOLVED with the evidence. It first checks
  that `DEMO_SPOT` is clean (02 §14) and fails with "run `demo:reset`" if not.
- `city-pulse.test.ts` (Phase 5, 02 §6): (1) the seeded scenario — public `GET /api/hotspots`
  shows the CRITICAL DRAINAGE hotspot with all 7 seeded issues (6 current, 1 baseline, expected
  0.33, trend 566.7, "6 DRAINAGE issues within ~300 m in the last 2 h (expected 0.3) — trend
  +566%."), its Polygon covers the Kurla centre and every seeded issue, and no hotspot is near
  `DEMO_SPOT`; (2) one test with ordered subtests (authority account needed): regenerate is 401
  without a session, 403 for a citizen, and 200 for the authority with new ids and a newer
  `generated_at` (GET then shows one generation); four fresh citizens report GARBAGE within ~100 m at
  a random quiet spot and, with no regenerate call, `after()` produces a HIGH hotspot (4 current,
  0 baseline, trend +400, capped below CRITICAL) within 15 s; a fifth citizen's supporting report
  leaves `generated_at` unchanged for 3 s and the count at 4 after a regenerate; the authority
  rejects one of the four — it disappears from `member_issue_ids` at once, and after a regenerate
  the 3 left are below minpoints, so the GARBAGE hotspot is gone.

## Things to know

- **The seeded City Pulse test needs a fresh `demo:reset`.** The oldest of the six current-window
  DRAINAGE issues is created 30 min before the reset and the current window is 2 h, so the seed
  produces "6 current, 1 baseline → CRITICAL" for about 90 minutes. Every new issue — from any
  test file — regenerates City Pulse (`after()`, 02 §6.8), so the test checks the seeded issues'
  ages against the active set's `generated_at` and is **skipped** ("seeded City Pulse scenario has
  aged out — run npm run demo:reset -- --local") instead of failing once they no longer fit (also
  if the seeded issues are missing or no longer open). The other City Pulse tests don't depend on
  the seed's age.
- **"Supports don't regenerate" is checked against other files.** Test files run in parallel, and
  their new issues regenerate City Pulse too. If the generation changes in the 3 s after the
  supporting report, the test fails only when no other issue was created meanwhile; otherwise it
  logs a diagnostic and moves on.

- **Tests leave rows behind.** `issue_events` is append-only, so nothing is cleaned up. Every
  test report uses a `[integration test]` description and a random point in northern Mumbai at
  least 2 km from `DEMO_SPOT` and from the City Pulse scenario (duplicate tests offset a few metres
  from such a point; `DEMO_SPOT` itself is never used). Category is `OTHER` unless the test is
  about categories (POTHOLE, WATERLOGGING, DRAINAGE). The authority tests also leave assigned,
  resolved, rejected and merged issues. Run `npm run demo:reset -- --local` before rehearsing the demo.
- **The DEMO_SPOT test is opt-in** because it is the only test that writes at `DEMO_SPOT`: it
  leaves a RESOLVED pothole there, which counts as recurrence (02 §5.8) for the next pothole and
  breaks the 47.25 / 50.17 calibration. **Run `npm run demo:reset` (`-- --local` locally) after
  it**, before a real demo and before running it again.
- **Each test uses fresh anonymous citizens**, so the per-user limit (5/h) never leaks between tests.
- **Fake client IPs.** Requests send `x-forwarded-for` with a random 198.18.0.0/15 address,
  one per test process. The route hashes the first entry, so the tests use up the per-IP budget
  (100/h) of that fake IP, not yours. On Vercel, the platform sets this header.
- **The per-IP test is opt-in** because it creates 100 reports and about 21 anonymous users.
  It uses its own fake IP, so it doesn't need a fresh `demo:reset`.
- **Auth's own limit.** Local Auth allows 100 anonymous sign-ins per hour per real IP
  (`supabase/config.toml`). A default run uses about 41 anonymous sign-ins (and 3 password sign-ins
  for the authority, one per file that needs it), and the per-IP test uses about 21 more. Running
  many times in an hour can hit that limit, and sign-in then fails.
- **The queue grows.** Every run adds open issues, so `authority.test.ts` checks the queue's
  order and filters over whatever is there rather than an exact list.

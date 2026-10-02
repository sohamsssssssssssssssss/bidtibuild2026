# API integration tests (Phases 1–3)

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
npm run test:integration
RUN_IP_LIMIT_TEST=1 npm run test:integration   # also run the per-IP limit test (opt-in)
```

| Variable | Default | Notes |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | where `npm run dev` listens |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from `.env.local` / `.env` | required, or the tests skip |
| `IP_HASH_SALT` | from `.env.local` | optional for the tests; if set, the stored `reporter_ip_hash` is checked exactly |
| `AUTHORITY_EMAIL`, `AUTHORITY_PASSWORD` | from `.env.local` / `.env` | the account `demo:reset` created; without them every test that acts as the authority is skipped with that reason (with `INTEGRATION_REQUIRED=1` they fail instead) |
| `RUN_IP_LIMIT_TEST=1` | off | enables `ip-limit.test.ts` |
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
  `assignIssue()` / `startWork()` / `resolveIssue()` / `assignStartResolve()`.
- `register.ts`: a resolve hook (`node --import`) that lets Node's type stripping load the
  extensionless imports inside `src/contracts`.
- `reports.test.ts`: create → detail / map / My Reports / photo route, validation and auth errors, and the per-user rate limit.
- `rls.test.ts`: direct Supabase access as an anonymous citizen: table writes, reads, RPCs and Storage.
- `ip-limit.test.ts`: the per-IP rate limit (opt-in).
- `authority.test.ts` (Phase 2): 401/403 on every authority route; the seed's departments;
  priority + severity (events only on change), assign / reassign with SLA, start, resolve with
  evidence, the timeline and My Reports; disallowed transitions (409), REOPENED (501); rejection
  (note required, hidden publicly, still visible to the reporter, `private, no-store` photo); the
  queue (open statuses only, filters, v1 order). The queue-v1 expectations live in
  `expectQueueRecommendation()` / `expectQueueOrder()` — change those two when Phase 4 lands.
- `duplicates.test.ts` (Phase 3): duplicate candidates (radius of the new report's category,
  EXACT vs FAMILY, ranking, photo), supporting reports, support/merge on closed issues, authority
  merge (moves reports, no chains, My Reports follow), and the judge-demo path (03 §6 steps 2–8).

## Things to know

- **Tests leave rows behind.** `issue_events` is append-only, so nothing is cleaned up. Every
  test report uses a `[integration test]` description and a random point in northern Mumbai at
  least 2 km from `DEMO_SPOT` and from the City Pulse scenario (duplicate tests offset a few metres
  from such a point; `DEMO_SPOT` itself is never used). Category is `OTHER` unless the test is
  about categories (POTHOLE, WATERLOGGING, DRAINAGE). The authority tests also leave assigned,
  resolved, rejected and merged issues. Run `npm run demo:reset -- --local` before rehearsing the demo.
- **Each test uses fresh anonymous citizens**, so the per-user limit (5/h) never leaks between tests.
- **Fake client IPs.** Requests send `x-forwarded-for` with a random 198.18.0.0/15 address,
  one per test process. The route hashes the first entry, so the tests use up the per-IP budget
  (100/h) of that fake IP, not yours. On Vercel, the platform sets this header.
- **The per-IP test is opt-in** because it creates 100 reports and about 21 anonymous users.
  It uses its own fake IP, so it doesn't need a fresh `demo:reset`.
- **Auth's own limit.** Local Auth allows 100 anonymous sign-ins per hour per real IP
  (`supabase/config.toml`). A default run uses about 35 anonymous sign-ins (and 2 password sign-ins
  for the authority, one per file that needs it), and the per-IP test uses about 21 more. Running
  many times in an hour can hit that limit, and sign-in then fails.
- **The queue grows.** Every run adds open issues, so `authority.test.ts` checks the queue's
  order and filters over whatever is there rather than an exact list.

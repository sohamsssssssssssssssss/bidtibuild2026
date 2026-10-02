# API integration tests (Phase 1)

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
| `RUN_IP_LIMIT_TEST=1` | off | enables `ip-limit.test.ts` |
| `INTEGRATION_REQUIRED=1` | off | fail instead of skip when the stack is missing |

The stack check needs the Supabase URL and `APP_URL` to accept a TCP connection within 2 s, and
`GET /api/issues?bbox=…` to answer 200.

## Files

- `helpers.ts`: env loading, the stack check and skip reason, `newCitizen()` (a fresh anonymous
  session), `uploadPhoto()` (a hard-coded 1×1 JPEG at `{uid}/{uuid}.jpg`), `expectPhoto()`
  (GETs a `/api/photos/...` path and checks the JPEG bytes and cache header), `api()`,
  `adminClient()`, and envelope assertions validated against `src/contracts`.
- `register.ts`: a resolve hook (`node --import`) that lets Node's type stripping load the
  extensionless imports inside `src/contracts`.
- `reports.test.ts`: create → detail / map / My Reports / photo route, validation and auth errors, and the per-user rate limit.
- `rls.test.ts`: direct Supabase access as an anonymous citizen: table writes, reads, RPCs and Storage.
- `ip-limit.test.ts`: the per-IP rate limit (opt-in).

## Things to know

- **Tests leave rows behind.** `issue_events` is append-only, so nothing is cleaned up. Every
  test report uses category `OTHER`, a `[integration test]` description, and a random point in
  northern Mumbai at least 2 km from `DEMO_SPOT` and from the City Pulse scenario. Run
  `npm run demo:reset -- --local` before rehearsing the demo.
- **Each test uses fresh anonymous citizens**, so the per-user limit (5/h) never leaks between tests.
- **Fake client IPs.** Requests send `x-forwarded-for` with a random 198.18.0.0/15 address,
  one per test process. The route hashes the first entry, so the tests use up the per-IP budget
  (100/h) of that fake IP, not yours. On Vercel, the platform sets this header.
- **The per-IP test is opt-in** because it creates 100 reports and about 21 anonymous users.
  It uses its own fake IP, so it doesn't need a fresh `demo:reset`.
- **Auth's own limit.** Local Auth allows 100 anonymous sign-ins per hour per real IP
  (`supabase/config.toml`). A default run uses about 15 sign-ins, and the per-IP test uses about 21
  more. Running many times in an hour can hit that limit, and sign-in then fails.

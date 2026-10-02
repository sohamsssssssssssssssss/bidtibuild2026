# CivicPulse AI

Citizens report public infrastructure problems (potholes, broken streetlights, overflowing drains)
on a map. Authorities prioritise, assign, track and resolve them. Built for **Bid2Build 2026** by
Soham and Atharva.

- **Status:** backend for Phases 0–5 is done and tested against a real local Supabase stack.
  The frontend is in progress.
- **Specs:** [`docs/`](docs/README.md) is the source of truth. Start with `01_PRD.md`; every number
  and algorithm lives in `02_TECHNICAL_SPEC.md`.

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Supabase (Postgres 17 + PostGIS, Auth, Storage,
Realtime) · Zod · MapLibre + OpenFreeMap · Vercel. Nothing else is added without updating 02 §1.

## Repository layout

| Path | What's there |
|---|---|
| `docs/` | PRD, technical spec, app flow, schema, plan, guardrails, work split |
| `src/config/civic.ts` | every constant from 02, the status transitions, `DEMO_SPOT`, map defaults |
| `src/contracts/` | Zod request/response schemas for every API route (build the frontend against these) |
| `src/app/api/` | API route handlers |
| `src/lib/api/`, `src/lib/supabase/` | route helpers (envelope, parsing, auth, errors) and Supabase clients |
| `supabase/migrations/` | the database: tables, RLS, storage buckets, and every SQL function |
| `supabase/seed.sql` | demo data: departments, risk zones, ~39 issues, the City Pulse scenario |
| `supabase/tests/` | SQL tests, run by `npm run db:test` |
| `tests/unit/`, `tests/integration/` | Node test suites (see [Tests](#tests)) |
| `scripts/demo-reset.ts` | `npm run demo:reset` |

## Run it locally

**Prerequisites:** Node ≥ 22.18 and Docker.

```bash
npm install
npx supabase start                 # first run pulls ~10 images
npx supabase status -o env         # shows the URL and keys for .env.local
cp .env.example .env.local         # then fill it in (table below)
npm run demo:reset -- --local      # rebuild DB + seed, create the authority, run City Pulse
npm run dev                        # http://localhost:3000
```

| Variable | Where from | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` from `supabase status` | safe for the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` | safe for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` | **server only**; never prefix with `NEXT_PUBLIC_` |
| `IP_HASH_SALT` | any random string | server only; salts the per-IP rate-limit hash |
| `AUTHORITY_EMAIL`, `AUTHORITY_PASSWORD` | choose them | `demo:reset` creates this authority login; never commit them |

`.env.local` is git-ignored.

<details>
<summary>If <code>supabase start</code> can't pull images</summary>

The CLI pulls from `public.ecr.aws` by default. If that's blocked, use Docker Hub:

```bash
export SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io
npx supabase start
```

If Docker Hub then rate-limits you (`429 Too Many Requests`), pull the missing image through
Google's mirror and tag it with the name the CLI asked for, then rerun `supabase start`:

```bash
docker pull mirror.gcr.io/supabase/gotrue:v2.197.0
docker tag  mirror.gcr.io/supabase/gotrue:v2.197.0 supabase/gotrue:v2.197.0
docker pull mirror.gcr.io/library/kong:2.8.1 && docker tag mirror.gcr.io/library/kong:2.8.1 kong:2.8.1
```
</details>

## Hosted setup (Supabase + Vercel)

1. Create a Supabase project. In the dashboard, under **Authentication**:
   - enable **anonymous sign-ins** (citizens never sign up);
   - raise the **anonymous sign-in rate limit per IP** to at least **100/hour**, because a whole
     venue shares one IP (02 §7.1).
2. `npx supabase link --project-ref <ref>`, then `npm run demo:reset` (without `--local`). This
   rebuilds the linked database, so never point it at data you want to keep.
3. On Vercel, set the five variables above. The service-role key and `IP_HASH_SALT` must stay
   server-only.

## Demo prep

- Run `npm run demo:reset` **shortly before presenting**. The seeded drainage hotspot only reads
  CRITICAL for about **90 minutes** after a reset, and leftover test data can disturb the demo.
- The judge script is in [`docs/03_APP_FLOW.md` §6](docs/03_APP_FLOW.md). Use three separate
  sessions (phone, incognito window, normal window): logging in as the authority replaces the
  anonymous citizen session in that browser.
- The demo pothole goes at `DEMO_SPOT` (`src/config/civic.ts`). Its recommended priority is HIGH,
  around 47.25 with one reporter and 50.17–50.18 with two.
- Rehearse the backend path with `RUN_DEMO_SPOT_TEST=1 npm run test:integration`, then **reset
  again**, because that test leaves a resolved pothole at `DEMO_SPOT`.

## Tests

| Command | Needs | Covers |
|---|---|---|
| `npm run typecheck` | nothing | strict TypeScript across the repo |
| `npm run test:unit` | nothing | priority labels, the 02 §5 formula against `PRIORITY_CONFIG`, transition helpers |
| `npm run db:test` | local Postgres 16 + PostGIS on `localhost:5432` (user/password `postgres`) | every SQL function, RLS, storage policies, seed, City Pulse, TS↔SQL transition agreement, concurrent City Pulse runs |
| `npm run test:integration` | `supabase start` + `demo:reset --local` + `npm run dev` | the real API end to end, including the judge-demo flow |

- `db:test` rebuilds a throwaway database from the migrations on plain Postgres, using a small
  Supabase stand-in (`scripts/db-test/supabase-shim.sql`). It's quick and needs no Docker.
  `SKIP_SEED=1` runs it without the seed, and `DB_ADMIN_URL` / `DB_NAME` point it elsewhere.
- `test:integration` skips (exit 0) when the stack isn't running. `INTEGRATION_REQUIRED=1` makes
  that a failure. Opt-in extras: `RUN_IP_LIMIT_TEST=1` and `RUN_DEMO_SPOT_TEST=1`. Details are in
  [`tests/integration/README.md`](tests/integration/README.md).

## API at a glance

Every route returns `{ "data": T | null, "error": { "code", "message" } | null }`, where `message`
is safe to show users. Shapes are in `src/contracts/`; 02 §13 is the full spec.

| Route | Who |
|---|---|
| `GET /api/issues?bbox=minLng,minLat,maxLng,maxLat` · `GET /api/issues/:id` · `GET /api/hotspots` | public |
| `GET /api/photos/{report\|evidence}/:id` | public (rejected issues: authority and reporters only) |
| `POST /api/reports` · `GET /api/duplicate-candidates` · `POST /api/issues/:id/support` · `GET /api/my-reports` | any session (citizens are anonymous) |
| `GET /api/departments` · `GET /api/authority/queue` · `PATCH /api/issues/:id/priority` · `POST /api/issues/:id/assign` · `PATCH /api/issues/:id/status` · `POST /api/issues/:id/resolution` · `POST /api/issues/:id/merge` · `POST /api/hotspots/regenerate` | authority |

Photos are uploaded straight from the browser to Storage at `{uid}/{uuid}.jpg`
(`report-photos` or `resolution-photos`). The client sends that path as `image_path`, and
responses link photos as `/api/photos/...`, never by storage URL.

## Conventions

- **Writes:** browser → API route (Zod + session check) → a `SECURITY DEFINER` Postgres function
  that re-checks permissions and writes the change plus its audit event in one transaction.
  Clients never write tables directly.
- **Numbers** live only in `docs/02` and `src/config/civic.ts`. SQL gets them as `p_config`.
- **SQL errors** use `errcode 'PT<http status>'` with an `ERROR_CODES` key as the message
  (`docs/04` §3); routes turn them into friendly API errors.
- **Database changes** ship as a new migration, never an edit to a merged one, together with the
  matching `docs/` and `src/contracts/` changes in the same PR.
- **Who owns what** is in [`docs/WORK_SPLIT.md`](docs/WORK_SPLIT.md).

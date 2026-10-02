# CivicPulse AI — Work Split
**Version:** 0.3
**Atharva:** backend — Supabase/PostGIS, migrations, database functions, API routes, tests.
**Soham:** frontend — app shell, map, citizen screens, authority screens, polish.

Both work the **same phase** at the same time. Every phase ends at its integration gate on the deployed preview. Phase exit conditions are in `05` §2.

## Contract ownership

| Contract | Owner | Reviewer |
|---|---|---|
| `supabase/migrations/`, `supabase/seed.sql` | Atharva | Soham |
| `src/config/civic.ts` | Atharva | Soham |
| `src/contracts/` (Zod schemas + API types) | Atharva | Soham |
| `src/components/map/CityMap` | Soham | Atharva |
| `docs/` | Whoever changes a contract, in the same PR | the other person |

Rules:
- Any contract change ships as one PR containing the doc, migration and contract-type updates.
- Merge to `main` at least daily, and keep `main` deployable.
- Don't start phase N+1 work that depends on gate N until gate N passes.

---

## Phase 0 — Foundation
**Atharva delivers the contracts first, so Soham can build against real shapes from the start.**

| Atharva | Soham |
|---|---|
| Supabase project; enable PostGIS; enable anonymous sign-ins; raise the anonymous per-IP limit (`02` §7.1) | Next.js scaffold: TS strict, Tailwind, lint/format, `.env.example` |
| Migrations: enums, tables, checks, indexes, append-only trigger, `is_authority`, RLS (`04`) | Vercel project, env vars, preview deploys |
| Storage buckets + policies (`02` §10.2) | Supabase browser/server client helpers; silent anonymous sign-in on first load |
| `src/config/civic.ts` (all `02` constants, `DEMO_SPOT`, `MAP_DEFAULT_VIEW`) | `<CityMap>`: MapLibre + OpenFreeMap, GeoJSON source with clustering, category icons, status colours |
| `src/contracts/`: Zod schemas + types for every route in `02` §13 | App shell: citizen vs authority layouts, navigation, phone-first responsive base |
| `seed.sql` + `npm run demo:reset` (`02` §14), including choosing `DEMO_SPOT` | Status/category legend component |
| Read routes returning seeded data: `GET /api/issues`, `/api/issues/:id`, `/api/my-reports`; every mutation route stubbed with `501` | |

**Gate:** after `demo:reset`, the deployed preview shows the seeded issues on the map on a phone and a laptop.

## Phase 1 — Citizen slice

| Atharva | Soham |
|---|---|
| `create_report` function | Report form: category, description, photo, pin, optional severity |
| `POST /api/reports`: Zod, `getUser`, IP hash, image-path check, 429 handling | Photo helper: decode, re-encode and size check in the browser (`02` §10.1), then direct upload |
| `GET /api/my-reports`, `GET /api/issues/:id` with sanitised output | Location picker: GPS, tap/drag, works with permission denied |
| Integration tests: create, both rate limits, RLS (anonymous user can't read others' reports or write tables) | Submission success, Issue Detail and My Reports screens; loading, empty and error states |

**Gate:** a report made on the phone appears on the laptop map and in the phone's My Reports.

## Phase 2 — Authority workflow

| Atharva | Soham |
|---|---|
| Authority account in `demo:reset`; authority check helper for routes | Authority login screen |
| `set_priority`, `assign_issue`, `transition_issue`, `resolve_issue` + routes; `GET /api/departments` | Command Center: map + queue side by side, filters |
| `authority_queue` v1: sort by final priority, then age (factors come in Phase 4) | Issue Workspace: photos, timeline, severity + priority controls, department picker with suggestion, Start / Resolve / Reject actions, resolution photo upload |
| Realtime publication + RLS check for `issues` | My Reports: Realtime subscription, refetch on focus, manual refresh |
| Tests: every transition, TS ↔ SQL transition agreement, append-only trigger (including service role) | Show citizens the resolution evidence on Issue Detail |

**Gate:** the organisers' demo **minus the duplicate step** runs end to end across two devices.

## Phase 3 — Duplicates

| Atharva | Soham |
|---|---|
| `duplicate_candidates` + `GET /api/duplicate-candidates` | Duplicate Candidates screen: ranked list, distance, photo, status, report count |
| `add_supporting_report` + `POST /api/issues/:id/support` | "Same issue" / "Create a new issue" flow wired into the report form |
| `merge_issue` + `POST /api/issues/:id/merge` | Workspace: supporting-reports list, merge target picker |
| Tests: per-category radius, compatible family, ranking order, exclusions, merge moves reports with no chains | |

**Gate:** the organisers' full demo script runs end to end.

## Phase 4 — Recommended priority

| Atharva | Soham |
|---|---|
| Full `authority_queue`: all five factors, score, label, severity source (`02` §5) | Priority breakdown panel: each factor, severity source, label |
| Risk zones in the seed, including the demo zone; test that it contains `DEMO_SPOT` | Queue shows the recommended label and sorts by score |
| Calibration regression test (`02` §5.10) | |

**Gate:** the demo pothole shows **HIGH** with its breakdown, before and after the second citizen attaches.

## Phase 5 — City Pulse

| Atharva | Soham |
|---|---|
| `regenerate_city_pulse`: DBSCAN, trend, geometry, advisory lock (`02` §6) | Hotspot overlay layer on `<CityMap>` |
| `after()` hook in `POST /api/reports`; `POST /api/hotspots/regenerate`; `GET /api/hotspots` | Hotspot detail: member issues, explanation, "generated N min ago" |
| City Pulse seed scenario; tests: one CRITICAL hotspot, correct members, concurrent runs leave one active set | Regenerate button in the Command Center |

**Gate:** after `demo:reset`, the CRITICAL drainage hotspot appears, and Regenerate works.

## Phase 6 — Hardening (both)

| Atharva | Soham |
|---|---|
| Playwright judge-path E2E with three browser contexts (`02` §15) | Responsive QA at 375 px; accessibility basics (labels, focus, contrast) |
| Failure paths: upload failure, Realtime off, rate-limit message | Empty, loading and error states across every screen |
| Repeated `demo:reset` rehearsal; README setup steps | Demo script polish; backup screen recording |

**Both:** rehearse the judge demo (`03` §6) within the time target, plus a timed citizen report (`01` §7).

## If behind schedule
Follow `05` §4. The cut items split as follows:
- **Recurrence:** Atharva sets it to 0.
- **Merge:** both drop it.
- **City Pulse detail screen:** Soham drops it.
- **Recommended priority:** both drop it; use the fallback demo script.

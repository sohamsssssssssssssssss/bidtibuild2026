# CivicPulse AI — Build Docs v0.3

**Status:** build source of truth. Supersedes v0.2 (Markdown bundle) and v0.1 (Word bundle).
**Team:** Soham + Atharva · **Hackathon:** Bid2Build 2026

Read in order:

1. `01_PRD.md` — what we build and why, scope tiers
2. `02_TECHNICAL_SPEC.md` — every number and algorithm (the only place they live)
3. `03_APP_FLOW.md` — screens, user paths, judge demo
4. `04_DATABASE_SCHEMA.md` — tables, functions, security
5. `05_IMPLEMENTATION_PLAN.md` — phases, cut order, definition of done
6. `06_RULES_GUARDRAILS.md` — non-negotiables
7. `WORK_SPLIT.md` — who builds what, phase by phase

**Open item:** hackathon duration. Phase hour budgets in `05` stay as percentages until it is known.

## Changes from v0.2

| Area | v0.2 | v0.3 |
|---|---|---|
| Citizen identity | Custom device token + server-side session hash | Supabase anonymous sign-in; `reports.reporter_user_id = auth.uid()` |
| Photo upload | 10 MB upload; where EXIF is stripped unspecified (Vercel caps bodies at 4.5 MB) | Browser re-encode strips EXIF, target < 1 MB, direct upload to Storage; bucket enforces type/size |
| Duplicate candidates | `GET /api/issues/:id/duplicate-candidates` (issue doesn't exist yet) | `GET /api/duplicate-candidates?lat&lng&category` |
| IP rate limit | 20/hour (whole venue shares one IP) | 100/hour |
| Roles | admin / authority / officer used interchangeably | One role: `AUTHORITY` |
| Severity | `officer_severity`, no UI to set it | `authority_severity`, set in the issue workspace |
| Priority labels | LOW < 40, MEDIUM < 60, HIGH < 80 (fresh issues always LOW) | LOW < 25, MEDIUM < 40, HIGH < 55, CRITICAL ≥ 55, plus a demo regression test |
| Priority storage | Persisted factor JSON | Every factor computed at read time; nothing about the score is stored |
| Removed columns | — | `issues.title`, `support_count`, `assigned_user_id`, `priority_factors`, all `ai_*`; `users.department_id`; `reports.reporter_session_hash`; `issue_events.actor_session_hash` |
| Merge | Semantics open | Reports move to the target issue; merge chains impossible |
| Recurrence window | "resolved/created" | `resolved_at` |
| Reassignment | Not allowed | `ASSIGNED`/`IN_PROGRESS → ASSIGNED` with a different department |
| Reopen | In P0 flow | Stretch |
| City Pulse execution | Inside the report request | After the response (`after()`), plus an authority action; advisory lock; buffered convex hull geometry |
| Write path | Unspecified | Every mutation: API route → Postgres function; no direct client table writes |
| Cut order | Cut items that weren't scheduled | Real order, with a fallback demo script (`05` §4) |
| Work split | Provisional frontend/backend | Both work the same phase; integration gate per phase (`WORK_SPLIT.md`) |
| Enums | `severity_level`, `priority_level`, `hotspot_severity` | One `level` enum |
| Demo data | No marker | `issues.is_seed` drives a "demo data" badge |

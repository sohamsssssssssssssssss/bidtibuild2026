# CivicPulse AI — Implementation Plan
**Version:** 0.3
**Team:** Soham + Atharva
**Hackathon duration:** TBD — §6 converts to hours once it's known.

Per-person tasks for every phase are in `WORK_SPLIT.md`.

## 1. Principle
- Both people work on the **same phase** at the same time: Atharva on the backend, Soham on the frontend.
- Each phase ends with an integration gate on the deployed preview before the next phase starts.
- A broken contract should show up within one phase, not on demo day.

## 2. Phases

| Phase | Tier | Exit condition |
|---|---|---|
| 0 Foundation | P0 | Deployed app boots; anonymous sign-in works; migrations, seed and `demo:reset` work; the map shows seeded issues; `src/contracts/` and `src/config/civic.ts` exist |
| 1 Citizen slice | P0 | A real report with a photo persists and appears on the map and in My Reports |
| 2 Authority workflow | P0 + reject | From the UI: set priority, assign, start work, resolve with evidence, reject; the citizen sees updates live |
| 3 Duplicates | P1 (+ merge, P2) | A second nearby report attaches to the existing issue; authority merge works |
| 4 Recommended priority | P2 | The queue sorts by computed score and shows the breakdown; the calibration test (`02` §5.10) passes |
| 5 City Pulse | P2 | After `demo:reset`, the seeded scenario shows a CRITICAL hotspot; Regenerate works |
| 6 Hardening | — | Judge E2E is green on a clean reset; the demo is rehearsed within the time target |

## 3. Dependencies
- Phase 0 blocks everything.
- Phase 2 needs Phase 1's issue creation.
- Phase 3 needs the report/issue split (Phase 0 schema) and Phase 1 report creation.
- Phase 4 needs reports (support factor) and risk zones (Phase 0 seed).
- Phase 5 needs issues and spatial indexes only, so it can start early if someone is blocked.
- Phase 6 needs everything that is still in scope.

## 4. Cut order
If behind schedule, cut in this order:
1. **Reopen.** Already stretch; never start it unless everything else is done.
2. **Recurrence.** Recurrence becomes 0. Keep only the single demo risk zone, which keeps the `02` §5.10 calibration intact.
3. **Authority merge.**
4. **City Pulse UI polish.** Drop the detail screen and animations. Keep the engine, the overlay polygon and a plain member list.
5. **Recommended priority.** The queue sorts by final priority, then age. Use the fallback demo script in `03` §6.

**Never cut:** reporting, map, My Reports, authority priority/assignment/status, resolution evidence, citizen duplicate detection, the audit trail, reproducible `demo:reset`.

## 5. Definition of done
A task is DONE only when:
- it's implemented and merged to `main`
- it's visually checked on the deployed preview (desktop and 375 px phone width)
- its relevant tests pass
- its error states are handled
- the judge path still needs no manual database or terminal work
- the docs and contracts still match the code

## 6. Time budget
Hours stay undefined until the duration is known. Planning split:

| Phase | Share |
|---|---:|
| 0 Foundation | 10% |
| 1 Citizen slice | 25% |
| 2 Authority workflow | 25% |
| 3 Duplicates | 15% |
| 4 Recommended priority | 10% |
| 5 City Pulse | 10% |
| 6 Hardening + rehearsal | 5% |

Phases 4 and 5 compress first, following §4.

## 7. Demo risks
| Risk | Mitigation |
|---|---|
| Venue IP shared by everyone | Raised limits (`02` §7.1, §9) |
| OpenFreeMap or venue Wi-Fi down | Backup screen recording of the full judge path |
| Realtime drops | Refetch on focus + manual refresh (`02` §11) |
| Cold serverless start | Open every screen once before presenting |
| Authority login replaces citizen session | Separate browsers/devices (`03` §6) |

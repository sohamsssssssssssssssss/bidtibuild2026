# CivicPulse AI — Technical Specification
**Version:** 0.3
**Rule:** this file is the **single source of truth for every numeric constant and algorithm**. Other docs refer here by section number.

## 1. Stack
- Next.js 15+ (App Router) + TypeScript strict — needs `after()` from `next/server`
- Tailwind CSS
- MapLibre GL JS + OpenFreeMap vector tiles (style `https://tiles.openfreemap.org/styles/liberty`)
- Supabase: Postgres + PostGIS, Auth (anonymous + email/password), Storage, Realtime
- Zod for request validation
- Playwright for the judge-path E2E test
- Vercel deployment

Add no other runtime dependency without updating this section.

## 2. Configuration
- Every constant in this document is implemented once, in `src/config/civic.ts`.
- SQL functions never hard-code these values. The server passes the relevant config object as a `jsonb` argument (`p_config`).
- Two exceptions live in migrations and are mirrored as TypeScript types in `civic.ts`:
  - enum values
  - allowed status transitions (§4). SQL enforces them; the UI uses the TS copy to decide which buttons to show. An integration test checks the two agree.

## 3. Duplicates

### 3.1 Categories
`POTHOLE`, `STREETLIGHT`, `GARBAGE`, `WATER_LEAK`, `DRAINAGE`, `WATERLOGGING`, `FOOTPATH`, `PUBLIC_PROPERTY`, `OTHER`

### 3.2 Radii
Used for duplicate candidates and for recurrence (§5.8).

| Category | Radius |
|---|---:|
| STREETLIGHT | 30 m |
| POTHOLE | 50 m |
| FOOTPATH | 50 m |
| PUBLIC_PROPERTY | 50 m |
| OTHER | 50 m |
| GARBAGE | 75 m |
| WATER_LEAK | 75 m |
| DRAINAGE | 150 m |
| WATERLOGGING | 150 m |

### 3.3 Candidate eligibility
A candidate issue must:
- have status `REPORTED`, `ASSIGNED` or `IN_PROGRESS` (plus `REOPENED` once the reopen stretch ships)
- have been created within the last **30 days**
- lie within the radius of the **new report's** category
- have a compatible category (§3.4)

### 3.4 Category compatibility
- An exact category always matches.
- Cross-category matching is allowed only inside one family: `DRAINAGE ↔ WATERLOGGING ↔ WATER_LEAK`.

### 3.5 Ranking
The order is deterministic:
1. exact-category matches before family matches
2. then distance, ascending
3. then newest first

Return at most **5** candidates. Each carries: issue id, category, status, distance in metres, report count, primary photo, `created_at`.

No confidence score is shown or stored, because there is no real model behind one. Text and image similarity are stretch.

### 3.6 Citizen rule
Never auto-merge. Show the ranked candidates and let the citizen choose **"This is the same issue"** (adds a supporting report) or **"Create a new issue"**.

### 3.7 Authority merge
- The source and target must each have status `REPORTED`, `ASSIGNED` or `IN_PROGRESS`, and must be different issues.
- Everything happens in one transaction:
  1. move every source report to the target (`reports.issue_id = target`)
  2. repoint earlier merges: `merged_into_issue_id = target` where it was `source`
  3. set the source to `MERGED` with `merged_into_issue_id = target`
  4. write `MERGED_INTO` on the source and `MERGED_FROM` on the target, with the moved report ids in `metadata`
- Result: no merge chains exist. Citizens' My Reports follow their own report rows, so they see the target issue automatically.

## 4. Status model
Main path: `REPORTED → ASSIGNED → IN_PROGRESS → RESOLVED`
Exceptional: `REJECTED`, `MERGED`; `REOPENED` (stretch)

| From | To | Who | Condition | Event |
|---|---|---|---|---|
| — | REPORTED | citizen | valid report | `CREATED` |
| REPORTED | ASSIGNED | authority | department given | `ASSIGNED` |
| ASSIGNED, IN_PROGRESS | ASSIGNED | authority | a *different* department | `REASSIGNED` |
| ASSIGNED | IN_PROGRESS | authority | — | `STATUS_CHANGED` |
| IN_PROGRESS | RESOLVED | authority | evidence row inserted in the same transaction | `RESOLVED` |
| REPORTED, ASSIGNED | REJECTED | authority | reason required | `REJECTED` |
| REPORTED, ASSIGNED, IN_PROGRESS | MERGED | authority | §3.7 | `MERGED_INTO` |

**Stretch (reopen):**

| From | To | Who | Condition | Event |
|---|---|---|---|---|
| RESOLVED | REOPENED | a citizen with a report on the issue, within **7 days** of `resolved_at`; or authority | reason required | `REOPENED` |
| REOPENED | ASSIGNED, IN_PROGRESS, REJECTED, MERGED | authority | as in the rows above | as above |

Non-status events: `SUPPORT_ADDED`, `SEVERITY_CONFIRMED`, `PRIORITY_SET`, `MERGED_FROM`.

Verify, cluster, prioritise and verify-resolution are processes, not statuses.

## 5. Recommended priority

### 5.1 Final priority
The authority sets `LOW | MEDIUM | HIGH | CRITICAL`. The recommendation never becomes the final priority automatically.

### 5.2 Computation
- Everything is computed at read time by `authority_queue(p_config)`, which sorts by the score.
- No score, factor or support count is stored.
- `ponytail:` every factor is recomputed per open issue on each call. That's fine into the low thousands of issues; materialise the factors if the queue gets slow.

### 5.3 Weights
| Factor | Weight |
|---|---:|
| Severity | 0.35 |
| Support | 0.20 |
| Age | 0.15 |
| Location risk | 0.20 |
| Recurrence | 0.10 |

### 5.4 Severity
- **Values:** LOW = 25, MEDIUM = 50, HIGH = 75, CRITICAL = 100
- **Effective severity:** `authority_severity`, else `citizen_severity` (copied from the issue's first report), else MEDIUM
- **Source:** returned as `AUTHORITY | CITIZEN | DEFAULT`
- AI severity (stretch) never enters this calculation.

### 5.5 Support
`support = min(100, 25 * log2(1 + distinct reporter_user_id across the issue's reports))`

### 5.6 Age
`age = min(100, hours_since_created / 168 * 100)`. It reaches 100 at 7 days.

### 5.7 Location risk
- The maximum `risk_value` (0–100) of all `risk_zones` that intersect the issue.
- An issue outside every zone gets `DEFAULT_LOCATION_RISK = 25`.

### 5.8 Recurrence
- `recurrence_count` = other issues with status `RESOLVED`, the same exact category, within that category's radius (§3.2), and `resolved_at` within the last **90 days**.
- `recurrence = min(100, 50 * recurrence_count)`

### 5.9 Score and label
`score = 0.35*severity + 0.20*support + 0.15*age + 0.20*risk + 0.10*recurrence`

| Score | Label |
|---|---|
| < 25 | LOW |
| 25 – < 40 | MEDIUM |
| 40 – < 55 | HIGH |
| ≥ 55 | CRITICAL |

The UI shows each factor, the severity source and the label.

### 5.10 Demo calibration (regression test)
The demo spot sits inside a seeded risk zone with `risk_value = 80` (§14). There must be no resolved pothole within 50 m in the last 90 days, so recurrence = 0.

| Case | Severity | Support | Age | Risk | Score | Label |
|---|---|---|---|---|---:|---|
| Demo pothole, first report (citizen picks HIGH) | 75 | 25.0 (1 reporter) | 0 | 80 | 47.25 | HIGH |
| After the second citizen attaches | 75 | 39.6 (2 reporters) | 0 | 80 | 50.17 | HIGH |
| Generic new report, no severity, outside zones | 50 | 25.0 | 0 | 25 | 27.50 | MEDIUM |

An integration test asserts all three rows.

## 6. City Pulse

### 6.1 Meaning
An emerging area-level pattern across **distinct issues**. Supporting reports never increase a hotspot's count.

### 6.2 Input
Issues that:
- have status `REPORTED`, `ASSIGNED` or `IN_PROGRESS` (plus `REOPENED` once built)
- were created in the last **8 hours**

Issues are grouped by exact category.

### 6.3 Clustering
```sql
ST_ClusterDBSCAN(ST_Transform(geom::geometry, 32643), eps := 300, minpoints := 4)
  OVER (PARTITION BY category)
```
- EPSG:32643 is metre-based UTM for the Mumbai demo area.
- Rows with a null cluster id (noise) are ignored.

### 6.4 Trend
- Current window: last **2 hours**. Baseline: the preceding **6 hours**.
- `expected_current = baseline_count / 3`
- A cluster becomes an active hotspot **only if `current_count >= 4`**.
- `trend_percent = (current_count - expected_current) / max(expected_current, 1) * 100`

### 6.5 Hotspot severity
| Condition | Level |
|---|---|
| trend < 50% | LOW |
| trend ≥ 50% | MEDIUM |
| trend ≥ 100% | HIGH |
| trend ≥ 200% **and** current_count ≥ 6 | CRITICAL |

If the trend is ≥ 200% but current_count is 4–5, cap the level at HIGH.

### 6.6 Geometry and membership
- **Shape:** `ST_Buffer(ST_ConvexHull(ST_Collect(<members in EPSG:32643>)), 50)`, transformed back to 4326 and stored as geography. The 50 m buffer keeps the shape an area even when the points fall in a line.
- **Membership:** every member of the cluster (the whole 8-hour input) is written to `hotspot_issues`.

### 6.7 Explanation
Generated text, e.g. "6 DRAINAGE issues within ~300 m in the last 2 h (expected 0.3) — trend +566%."

### 6.8 Execution
`regenerate_city_pulse(p_config)`:
1. first statement: `pg_advisory_xact_lock(hashtext('city_pulse'))`, so concurrent runs queue up instead of duplicating hotspots
2. in one transaction: deactivate the active hotspots, insert the new ones, insert their memberships

It is triggered by:
- `after()` in `POST /api/reports`, only when a **new issue** was created. Supporting reports and merges don't trigger it. Failure is logged and never affects the report response.
- `POST /api/hotspots/regenerate` (authority)
- `demo:reset` (§14)

Every hotspot carries `generated_at`, and the UI shows "generated N min ago". Hotspot rows are never seeded.

## 7. Identity, authorisation and write path

### 7.1 Citizens
- Supabase anonymous sign-in (`signInAnonymously()`) on first visit, with no UI.
- Clearing browser storage or switching browsers loses My Reports. Accepted for the MVP.
- In the Supabase dashboard: enable anonymous sign-ins, and raise the anonymous sign-in per-IP rate limit to **≥ 100/hour**, because a venue shares one IP.

### 7.2 Authority
- Email + password accounts are created by the reset script (§14) through the Auth admin API. Credentials come from env vars and are never committed.
- Authority means a row in `users` with role `AUTHORITY`.
- Anonymous sessions also use Postgres's `authenticated` role. Never treat `authenticated` as authority.
- Logging in as authority replaces the anonymous session in that browser. Run citizen and authority in separate browsers or devices.

### 7.3 Writes
Every mutation follows one path:
1. The browser calls a Next.js API route.
2. The route validates the input with Zod, verifies the session with `supabase.auth.getUser()`, and checks authority where needed.
3. It calls a Postgres function using the service role, passing `p_actor_id`.
4. The function re-checks authorisation and writes the change plus its `issue_events` row in one transaction.

- EXECUTE on these functions is granted to `service_role` only.
- No table has INSERT, UPDATE or DELETE RLS policies, so clients cannot write tables directly.
- The only direct client write is the photo upload (§10).

### 7.4 Reads
- Map, detail, queue and My Reports go through API routes.
- Public responses never include `reporter_user_id`, `reporter_ip_hash` or citizen actor ids.
- Realtime reads `issues` directly under RLS (`04` §4).
- The service-role key is server-only and never appears in a `NEXT_PUBLIC_*` variable.

## 8. SLA
- `departments.sla_hours` is seeded with a default of **72**.
- On assign or reassign: `sla_due_at = assigned_at + sla_hours`.
- Informational only: it never changes status or priority.

## 9. Rate limiting
Applies to `POST /api/reports` and `POST /api/issues/:id/support`. Counts come from `reports` rows inside the write function:
- **5** reports per `reporter_user_id` per rolling hour
- **100** reports per `reporter_ip_hash` per rolling hour

Details:
- `reporter_ip_hash = SHA-256(client IP + IP_HASH_SALT)`. The salt is a server-only env var.
- Going over the limit returns HTTP 429 with a friendly message.
- `demo:reset` clears `reports`, which resets the counters.
- `ponytail:` the count and insert are not serialised, so a burst of simultaneous requests can exceed the limit by a few. Add `pg_advisory_xact_lock` per user if that matters.

## 10. Photos

### 10.1 Client
1. Accept `image/*`. Reject originals over **10 MB** before decoding.
2. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })`, so rotation is applied before the metadata is dropped.
3. Draw to a canvas with the longest edge ≤ **1600 px**. Export as JPEG at quality **0.8**. The output has no EXIF (including GPS); target < **1 MB**.
4. If decoding fails (e.g. HEIC in a browser that can't read it), show a friendly error asking for JPEG or PNG.
5. Upload directly to Supabase Storage.

### 10.2 Buckets
| Bucket | Insert | Read | `allowed_mime_types` | `file_size_limit` |
|---|---|---|---|---|
| `report-photos` | authenticated; path must start with `{auth.uid()}/` | public | `image/jpeg` | 2 MB |
| `resolution-photos` | authority only | public | `image/jpeg` | 2 MB |

- Object path: `{uid}/{uuid}.jpg`.
- The API route checks that a submitted `image_path` starts with the caller's uid; `create_report` re-checks the prefix and that the object exists in storage.

### 10.3 Moderation
- Public API responses never return image paths for `REJECTED` issues.
- The objects stay in storage for audit, under unguessable paths.
- `ponytail:` anyone who already has the URL can still open it. Switch to a private bucket with signed URLs if that matters.
- No face or licence-plate redaction is claimed.

## 11. Realtime
- The `supabase_realtime` publication includes `issues`.
- My Reports subscribes to UPDATEs on `issues` where `id` is one of the caller's issue ids. Any event triggers a refetch of `GET /api/my-reports`.
- Fallbacks: refetch on window focus, plus a manual refresh button. The app must work with Realtime unavailable.

## 12. Map
- MapLibre + OpenFreeMap. Never depend on public OSM raster tiles for the live demo.
- `GET /api/issues` takes a bounding box.
- Markers show a category icon and a status colour, clustered with MapLibre's built-in GeoJSON `cluster: true`.
- The default viewport (`MAP_DEFAULT_VIEW`) and `DEMO_SPOT` live in `civic.ts`.

## 13. API
- Every response uses the envelope `{ data: T | null, error: { code: string, message: string } | null }`.
- Every route validates its input with the Zod schemas in `src/contracts/`.

| Route | Who | Input | Does |
|---|---|---|---|
| `POST /api/reports` | citizen | category, citizen_severity?, description, image_path, lat, lng | New issue + first report; schedules City Pulse via `after()` |
| `GET /api/duplicate-candidates` | citizen | lat, lng, category | §3.3–3.5 |
| `POST /api/issues/:id/support` | citizen | same body as `/api/reports` | Adds a report to an existing issue |
| `GET /api/issues` | public | bbox, category[], status[] | Map markers |
| `GET /api/issues/:id` | public | — | Detail, public photos, sanitised timeline, resolution evidence |
| `GET /api/my-reports` | citizen | — | Caller's reports, each with its current issue |
| `GET /api/departments` | authority | — | Department list for assignment |
| `GET /api/authority/queue` | authority | status, category, department filters | `authority_queue()` |
| `PATCH /api/issues/:id/priority` | authority | final_priority?, authority_severity? | Sets either or both |
| `POST /api/issues/:id/assign` | authority | department_id | Assign or reassign |
| `PATCH /api/issues/:id/status` | authority (citizen for REOPENED, stretch) | to_status: IN_PROGRESS, REJECTED, REOPENED; note | §4 |
| `POST /api/issues/:id/resolution` | authority | image_path, note | Evidence + RESOLVED |
| `POST /api/issues/:id/merge` | authority | target_issue_id, note | §3.7 |
| `GET /api/hotspots` | public | — | Active hotspots, member issue ids, `generated_at` |
| `POST /api/hotspots/regenerate` | authority | — | §6.8 |

## 14. Seed and demo reset
`npm run demo:reset` runs three steps:
1. `supabase db reset --linked`: rebuilds the whole database from migrations plus `supabase/seed.sql`. Because it rebuilds, the append-only trigger never needs to allow deletes.
2. Creates the authority account(s) through the Auth admin API, using `AUTHORITY_EMAIL` and `AUTHORITY_PASSWORD`.
3. Calls `regenerate_city_pulse`.

Seed contents (every timestamp relative to `now()`; every seeded issue has `is_seed = true`):
- **Departments**, each with `default_categories`: Roads, Street Lighting, Solid Waste, Water Supply, Storm Water Drainage.
- **Risk zone** "Demo arterial road" with `risk_value = 80`, containing `DEMO_SPOT`. `DEMO_SPOT` is chosen in Phase 0 inside the Mumbai demo area and recorded in `civic.ts`. A test asserts that the zone contains it.
- **About 30 normal issues** with reports across the demo area, in mixed statuses, with their events and evidence. Seeded reports use fixed demo `reporter_user_id` uuids.
- **City Pulse scenario:** 6 `DRAINAGE` issues within 300 m of each other created in the last 2 h, plus at most 1 in the preceding 6 h. This produces one CRITICAL hotspot (§6.5). It sits well away from `DEMO_SPOT`.
- **Clear demo spot:** no unresolved `POTHOLE` within 50 m of `DEMO_SPOT`, and no `RESOLVED` pothole there in the last 90 days, which keeps §5.10 exact.

## 15. Testing
**Integration** (local Supabase via `supabase start`):
- demo calibration (§5.10)
- every allowed transition succeeds; sample disallowed ones fail; the TS transitions match SQL
- `issue_events` UPDATE/DELETE raise an error, including as the service role
- duplicate candidates: per-category radius, compatible family, ranking order, exclusion of resolved and old issues
- merge moves reports and leaves no chains
- both rate limits
- City Pulse: the seed yields exactly one CRITICAL DRAINAGE hotspot with the right members; two concurrent runs leave one active set
- RLS: an anonymous user cannot read others' reports or write any table

**E2E** (Playwright): the judge path from a clean `demo:reset`, with three browser contexts (citizen A, citizen B, authority).

**Manual:** location permission denied, upload failure, Realtime off, rate-limit message, a false-positive duplicate, phone-width layout.

# CivicPulse AI — Rules / Guardrails
**Version:** 0.3

## Product truth
1. Never fabricate a location, report, authority action, AI result or hotspot and present it as live.
2. Seeded data is marked `is_seed` and shown with a "demo data" badge.
3. Seed **issues**, never hotspot results; City Pulse always runs the real engine.
4. The organiser MVP takes precedence over differentiators.
5. The map is the product's centre, not a generic ticket table.

## Duplicate truth
6. A duplicate is another report of the **same physical issue**.
7. A hotspot is a pattern of **distinct issues**.
8. Citizen duplicate candidates are never auto-merged.
9. Supporting an issue creates a report row; it is not an upvote.
10. Authority merges move reports to the target, are logged on both issues, and never create chains.

## Priority truth
11. Final priority is always an authority decision.
12. The system priority is a recommendation only.
13. AI severity never enters the priority formula.
14. Effective severity follows the source order in `02` §5.4.
15. Age is computed at read time and included when the queue is sorted.
16. Numeric priority rules exist only in `02_TECHNICAL_SPEC.md`.

## Status / audit truth
17. Only the transitions in `02` §4 are valid. SQL enforces them; the TypeScript copy drives the UI only.
18. Status changes happen only inside the database functions (`04` §3), and each one writes an audit event.
19. `issue_events` is append-only at the trigger level, including for the service role.
20. Resolving requires evidence.
21. Rejecting requires a reason and hides the photo publicly.

## Privacy / security
22. Citizen-facing responses never contain `reporter_user_id`, `reporter_ip_hash` or citizen actor ids.
23. EXIF (including GPS) is stripped before upload; buckets accept only re-encoded JPEG within the size limit.
24. Citizens are Supabase anonymous users; authority comes only from the `users` table, never from the `authenticated` role.
25. Rate limiting is database-backed; never rely on server memory.
26. Clients never write tables directly; every mutation goes through an API route and a database function.
27. The service-role key and IP salt are server-only, never in `NEXT_PUBLIC_*`.
28. Never claim automatic face or licence-plate redaction.

## AI (stretch only)
29. AI category/severity values are suggestions and are visibly labelled as such.
30. No fabricated confidence scores anywhere, including duplicate ranking.
31. AI failure never blocks manual reporting.
32. Preserve the citizen's original description.
33. AI never authorises a municipal action.

## Engineering
34. TypeScript strict mode.
35. Every database change ships as a migration, together with its doc and contract update in the same PR.
36. Shared constants are implemented once in `src/config/civic.ts` and passed to SQL as `p_config`.
37. Numeric constants appear in only one doc (`02`).
38. Minimal dependencies; the allowed stack is listed in `02` §1.
39. PostGIS is the source of truth for spatial questions.
40. Never depend on public OSM raster tile servers for the live demo.

## Scope
41. No service-area management, payments, procurement, payroll, emergency dispatch or municipal ERP.
42. Notifications, broad analytics, admin configuration, reopen and AI suggestions are stretch.
43. When the schedule slips, follow the cut order in `05` §4.

## Demo
44. The judge path works from a clean `demo:reset`.
45. No hidden terminal or database intervention during the demo.
46. No fake loading followed by hard-coded "live" intelligence.
47. Rehearse the citizen report against the time target in `01` §7.

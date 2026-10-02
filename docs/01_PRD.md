# CivicPulse AI — Product Requirements Document
**Version:** 0.3
**Hackathon:** Bid2Build 2026
**Problem:** Public Infrastructure Issue Mapping Platform
**Team:** Soham + Atharva
**Status:** Build source of truth

## 1. Product statement
CivicPulse AI is a location-aware platform where citizens report public infrastructure issues on a map and authorities prioritize, assign, track and resolve them.

The organisers' problem: one pothole gets reported by ten people through ten channels, none of them reach the right department, citizens can't see progress, and authorities can't tell what matters most. Every feature below answers one of those failures.

The product must first satisfy the organiser MVP:
- Issue report with **category, description, photo and pinned map location**
- Map showing issues with **category and status markers**
- **Priority level and department assignment by an admin** (our `AUTHORITY` role)
- Status workflow: **REPORTED → ASSIGNED → IN_PROGRESS → RESOLVED**
- Citizen view to track **their own reports**

## 2. Scope tiers

### P0 — Organiser MVP (must ship)
1. Citizen issue reporting
2. Interactive issue map
3. Citizen "My Reports"
4. Authority issue queue and workspace
5. Authority-set final priority
6. Department assignment (suggested from category, chosen by authority)
7. Status updates
8. Resolution evidence visible to the citizen

### P1 — Judge-demo critical (treat as required)
- **Citizen duplicate detection.** The organisers list it as a stretch goal but use it in their demo script. A second nearby report is shown ranked candidates and can attach to the existing issue.
- **Reject invalid/abusive reports.** Minimum moderation; hides the photo publicly.

### P2 — Differentiators (cut in the order given in `05` §4)
1. **Recommended Priority** — an explainable score; the authority still sets the final priority.
2. **City Pulse** — detects emerging area-level patterns across multiple **distinct issues**.
3. **Authority merge** of duplicate issues that citizens created separately.

### Stretch
AI category/severity suggestion, citizen reopen, notifications, analytics beyond demo cards, admin configuration screens.

## 3. Core concepts

### Report vs issue
A **report** is one citizen submission. An **issue** is the one physical problem.
Five citizens photographing the same pothole = 5 reports, 1 issue.

### Duplicate vs hotspot
A **duplicate** is another report of the same physical problem.
A **City Pulse hotspot** is several *distinct* issues of the same category forming an emerging pattern in one area.
An issue can never create a hotspot just because it has many reports.

## 4. Users

### Citizen (anonymous, no sign-up)
- Create a report: category, description, photo, location, optional severity
- See duplicate candidates and choose to attach or create a new issue
- Track own reports, status and resolution evidence

### Authority (email login, seeded accounts)
- View the issue map and queue
- Review evidence and supporting reports
- Confirm severity, set final priority
- Assign or reassign a department
- Move issues through allowed statuses; reject with a reason
- Upload resolution evidence
- Merge duplicate issues
- Regenerate City Pulse

## 5. Functional requirements

| ID | Requirement | Tier |
|---|---|---|
| FR-01 | Report with category, description, photo, pinned location | P0 |
| FR-02 | Map with category/status markers and filters | P0 |
| FR-03 | My Reports for the anonymous citizen session | P0 |
| FR-04 | Authority queue and issue workspace | P0 |
| FR-05 | Authority sets final priority | P0 |
| FR-06 | Authority assigns/reassigns department, with category-based suggestion | P0 |
| FR-07 | Status workflow REPORTED → ASSIGNED → IN_PROGRESS → RESOLVED | P0 |
| FR-08 | Resolution evidence shown to the citizen; live status update | P0 |
| FR-09 | Duplicate candidates and citizen choice | P1 |
| FR-10 | Reject with reason | P1 |
| FR-11 | Explainable recommended priority | P2 |
| FR-12 | City Pulse hotspot detection | P2 |
| FR-13 | Authority merge | P2 |
| FR-14 | Citizen reopen | Stretch |
| FR-15 | AI category/severity suggestion | Stretch |
| FR-16 | Notifications | Stretch |
| FR-17 | Analytics beyond demo cards | Stretch |
| FR-18 | Admin configuration screens (seed instead) | Stretch |

## 6. Judge demo
The full script is in `03_APP_FLOW.md` §6. Shape:
1. Citizen reports a pothole with photo and pinned location.
2. A second citizen nearby is shown it as a duplicate candidate and attaches to it.
3. Authority sees the recommended priority with its explanation and sets the final priority.
4. Authority assigns the department, starts work, uploads proof and resolves.
5. The first citizen's My Reports updates live.
6. Bonus: City Pulse shows a hotspot computed by the real engine from seeded issues.

## 7. Success criteria
- Complete report-to-resolution demo with no manual database edits or terminal use.
- New reports appear on the map.
- Duplicate candidates never auto-merge in the citizen flow.
- Supporting reports attach to one issue.
- Final priority is always an authority decision.
- Citizens can track their own anonymous-session reports.
- Resolution evidence is visible to citizens.
- City Pulse is generated from distinct seeded issues with timestamps relative to `now()`.
- Rehearsal target: a normal citizen report takes **under 60 seconds**.
- The judge path works on desktop and phone-sized screens.

## 8. Non-goals
- Full municipal ERP
- Payments, procurement, payroll
- Emergency dispatch
- Auto-routing by service area
- Production-grade citywide prediction
- AI autonomously authorizing municipal actions
- Admin configuration UI
- Automatic face/licence-plate redaction

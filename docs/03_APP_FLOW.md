# CivicPulse AI — App Flow
**Version:** 0.3
Numbers live in `02_TECHNICAL_SPEC.md`.

## 1. Citizen flow
First visit: anonymous sign-in happens silently (`02` §7.1).

`Map → Report Issue → Category* → Description* → Photo* → Pin location* → Severity (optional) → Duplicate check`
(\* required)

- **Photo:** compressed and stripped in the browser, then uploaded directly (`02` §10).
- **Pin location:** GPS or tap/drag on the map. If location permission is denied, manual pinning still works.
- **Duplicate check:** `GET /api/duplicate-candidates` runs before anything is saved.
  - No candidates → submit → new issue.
  - Candidates → **Duplicate Candidates** screen (ranked; distance, photo, status, report count):
    - **"This is the same issue"** → supporting report on that issue
    - **"Create a new issue"** → new issue

Then: `Submission Success → My Reports → Issue Detail (status timeline, resolution evidence)`

Failure paths:
- **Upload fails:** keep the form, offer a retry.
- **Rate limited:** show a friendly message (`02` §9).
- **Realtime down:** My Reports still refreshes on focus and has a manual refresh button.

## 2. Authority flow
`Login (email/password) → Command Center (map + queue sorted by recommended score) → Issue Workspace`

The Issue Workspace shows:
- primary photo plus every supporting report
- category, citizen severity
- recommended priority: label, factor breakdown, severity source
- final priority
- department, with a suggestion from `departments.default_categories`
- SLA due time
- timeline
- duplicate/merge tool (pick a nearby target issue)

Actions:
`Confirm severity → Set final priority → Assign department → Start work (IN_PROGRESS) → Resolve (after-photo + note)`

Also available:
- Reassign to a different department
- Reject (reason required; hides the photo publicly)
- Merge into another issue

City Pulse appears as an overlay on the Command Center map. A **Regenerate** button re-runs it, and the hotspot detail lists its member issues and explanation.

## 3. City Pulse flow
1. A new issue is saved and the response is returned.
2. City Pulse regenerates in the background (`02` §6.8).
3. The overlay updates on the next fetch.

Supporting reports and merges do not trigger it.

## 4. Reopen flow (stretch)
`RESOLVED → citizen requests REOPENED (within the window in 02 §4) → authority reviews → ASSIGNED or IN_PROGRESS`

## 5. Screens
1. Landing / Issue Map
2. Report Issue
3. Duplicate Candidates
4. Submission Success
5. Issue Detail
6. My Reports
7. Authority Login
8. Authority Command Center (map + queue)
9. Authority Issue Workspace
10. City Pulse Hotspot Detail

Stretch: Analytics, Admin configuration, Notification center.

## 6. Judge demo (target ≤ 3 minutes)
**Setup:**
- Run `npm run demo:reset`.
- Open three sessions:
  - **Citizen A** on a phone
  - **Citizen B** in a laptop incognito window
  - **Authority** in a normal laptop window

Citizen B must be a separate session: support counts *distinct* reporters (`02` §5.5), and the authority login replaces whichever anonymous session is in its browser.

**Script:**
1. Citizen A: the map shows seeded issues, each with a "demo data" badge.
2. Citizen A reports a pothole at `DEMO_SPOT` with a photo and severity HIGH.
3. Citizen B reports the same pothole nearby. The duplicate candidate appears; B chooses **"This is the same issue"**.
4. Authority opens the issue: the recommended priority is HIGH, with its breakdown and two reporters. The authority sets final priority HIGH.
5. Authority assigns the suggested department (Roads).
6. Authority clicks Start work → IN_PROGRESS.
7. Authority uploads the after-photo → RESOLVED.
8. Citizen A's phone shows RESOLVED live, with the evidence.
9. Bonus: the City Pulse overlay shows the CRITICAL drainage hotspot. Open its detail (member issues + explanation), then press Regenerate to show it is computed live.

**Fallback if recommended priority was cut** (`05` §4): in step 4 the authority sets the priority directly, with no breakdown shown.

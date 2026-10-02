# Judge-path E2E (Playwright)

The judge demo from [`docs/03_APP_FLOW.md` §6](../docs/03_APP_FLOW.md) run through the real UI,
with three isolated browser sessions (02 §15):

| Session | Fixture | Setup |
|---|---|---|
| Citizen A | `citizenA` | phone (Pixel 7 emulation), geolocation at `DEMO_SPOT` |
| Citizen B | `citizenB` | separate desktop context, geolocation ~10 m from `DEMO_SPOT` |
| Authority | `authority` | separate desktop context, logs in with `AUTHORITY_EMAIL` / `AUTHORITY_PASSWORD` |

## Run

```bash
npx playwright install chromium        # once per machine
npx supabase start
npm run demo:reset -- --local          # the judge script needs fresh demo data
npm run test:e2e                        # starts `npm run dev` unless it's already running
npm run demo:reset -- --local          # afterwards: the judge path leaves a resolved pothole at DEMO_SPOT
```

- `APP_URL` defaults to `http://localhost:3000`.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points at an already-installed Chromium if you can't run
  `playwright install` (for example `/opt/pw-browsers/chromium` in Claude Code cloud sessions).
- Specs run one at a time (`workers: 1`) because they share one demo database.

## Files

| File | What it does |
|---|---|
| `smoke.spec.ts` | Runs **today**, without UI: the three sessions are isolated, A is phone-sized, geolocation is pinned, every session reaches the API, and the demo data is fresh |
| `judge-path.spec.ts` | Steps 1–9 of 03 §6 through the UI. **Skips until the app shell renders on `/`** |
| `support/judge.ts` | Fixtures, screen `ROUTES`, the test photo, and `expectFreshDemoData()`, which fails with a "run demo:reset" hint when the seeded hotspot has aged out or `DEMO_SPOT` isn't clear |
| `pages/citizen.ts`, `pages/authority.ts` | Page objects; they only touch the UI through `TESTIDS` |

## For the frontend: what the judge path expects

1. **Selectors.** Put the ids from [`src/config/testids.ts`](../src/config/testids.ts) on the
   matching elements, e.g. `data-testid={TESTIDS.reportSubmit}`. The judge path starts running as
   soon as `TESTIDS.appShell` renders on `/`.
2. **Routes.** `ROUTES` in `support/judge.ts` assumes `/`, `/my-reports`, `/authority/login` and
   `/authority`. If the app uses other paths, change them there.
3. **Data attributes.** My Reports items and queue rows carry `data-issue-id`; hotspot items
   carry `data-hotspot-id`.
4. **Form controls.** Category, severity, final priority and department are `<select>`s whose
   option values are the enum values from `civic.ts` (department options are labelled with the
   department name). If you use custom pickers, adapt the page objects rather than the specs.
5. **Location.** "Use my location" (`TESTIDS.reportUseLocation`) reads the browser's geolocation.
6. **Live update.** Step 8 waits up to 20 s for Citizen A's open My Reports page to show
   RESOLVED **without a reload**, which proves the Realtime subscription (02 §11).

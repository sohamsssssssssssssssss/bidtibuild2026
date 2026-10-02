/**
 * The judge demo (03 §6) end to end through the UI, with three sessions: Citizen A (phone),
 * Citizen B (separate desktop session) and the Authority.
 *
 * Skips until the frontend renders its app shell. It writes at DEMO_SPOT, so run
 * `npm run demo:reset` afterwards, before a real demo.
 */
import { TESTIDS } from "../src/config/testids";
import { AuthorityApp } from "./pages/authority";
import { CitizenApp } from "./pages/citizen";
import { AUTHORITY, expect, expectFreshDemoData, test, uiReady } from "./support/judge";

test("judge path: report → duplicate → prioritise → assign → resolve → citizen sees it live", async ({
  citizenA,
  citizenB,
  authority,
  request,
}) => {
  test.skip(!(await uiReady(authority.page)), "frontend not built yet: no app shell on / (TESTIDS.appShell)");
  test.skip(!AUTHORITY.email || !AUTHORITY.password, "set AUTHORITY_EMAIL and AUTHORITY_PASSWORD");
  test.setTimeout(300_000);
  await expectFreshDemoData(request);

  const a = new CitizenApp(citizenA.page);
  const b = new CitizenApp(citizenB.page);
  const auth = new AuthorityApp(authority.page);
  let issueId = "";

  await test.step("1. Citizen A sees seeded issues marked as demo data", async () => {
    await a.openMap();
    await expect(citizenA.page.getByTestId(TESTIDS.demoDataBadge).first()).toBeVisible();
  });

  await test.step("2. Citizen A reports a HIGH pothole at DEMO_SPOT", async () => {
    await a.fillReport({ category: "POTHOLE", description: "Deep pothole in the left lane.", severity: "HIGH" });
    await a.submit();
    await a.expectSubmitted();
    await a.openMyReports();
    issueId = (await a.latestReport().getAttribute("data-issue-id")) ?? "";
    expect(issueId, "My Reports items need data-issue-id").not.toBe("");
    await expect(a.latestReport().getByTestId(TESTIDS.issueStatus)).toContainText(/REPORTED/i);
  });

  await test.step("3. Citizen B nearby is shown it as a duplicate and attaches", async () => {
    await b.openMap();
    await b.fillReport({ category: "POTHOLE", description: "Same pothole, a bike almost fell." });
    await b.submit();
    await b.chooseSameIssueAsFirstCandidate();
    await b.expectSubmitted();
  });

  await test.step("4. Authority sees HIGH with two reporters and sets final priority HIGH", async () => {
    await auth.login();
    await expect(auth.queueRow(issueId).getByTestId(TESTIDS.recommendedLabel)).toContainText(/HIGH/i);
    await auth.openIssue(issueId);
    await expect(authority.page.getByTestId(TESTIDS.reporterCount)).toContainText("2");
    await auth.setFinalPriority("HIGH");
  });

  await test.step("5. Authority assigns the suggested department (Roads)", async () => {
    await expect(authority.page.getByTestId(TESTIDS.departmentSelect)).toContainText("Roads");
    await auth.assign();
    await auth.expectStatus("ASSIGNED");
  });

  await test.step("6. Start work", async () => {
    await auth.startWork();
    await auth.expectStatus("IN_PROGRESS");
  });

  await test.step("7. Resolve with an after-photo", async () => {
    await auth.resolve("Patched and rolled.");
    await auth.expectStatus("RESOLVED");
  });

  await test.step("8. Citizen A's phone shows RESOLVED live, with the evidence", async () => {
    // A is still on My Reports from step 2: no reload, so this proves the Realtime update (02 §11).
    await expect(a.latestReport().getByTestId(TESTIDS.issueStatus)).toContainText(/RESOLVED/i, { timeout: 20_000 });
    await a.latestReport().click();
    await expect(citizenA.page.getByTestId(TESTIDS.resolutionEvidence)).toBeVisible();
  });

  await test.step("9. City Pulse shows the CRITICAL drainage hotspot, and Regenerate works", async () => {
    await auth.openCriticalHotspot();
    await expect(authority.page.getByTestId(TESTIDS.hotspotDetail)).toContainText(/DRAINAGE/);
    await authority.page.getByTestId(TESTIDS.hotspotRegenerate).click();
    await expect(authority.page.getByTestId(TESTIDS.hotspot).filter({ hasText: /CRITICAL/i }).first()).toBeVisible();
  });
});

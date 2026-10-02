import type { Page } from "@playwright/test";
import type { Category, Level } from "../../src/config/civic";
import { TESTIDS } from "../../src/config/testids";
import { ROUTES, TEST_PHOTO, expect } from "../support/judge";

/** Citizen screens (03 §1), driven only through TESTIDS. */
export class CitizenApp {
  constructor(readonly page: Page) {}

  async openMap(): Promise<void> {
    await this.page.goto(ROUTES.home);
    await expect(this.page.getByTestId(TESTIDS.map)).toBeVisible();
  }

  /** Fills the report form up to (not including) submit, pinning the device's GPS location. */
  async fillReport(r: { category: Category; description: string; severity?: Level }): Promise<void> {
    await this.page.getByTestId(TESTIDS.reportOpen).click();
    await this.page.getByTestId(TESTIDS.reportCategory).selectOption(r.category);
    await this.page.getByTestId(TESTIDS.reportDescription).fill(r.description);
    await this.page.getByTestId(TESTIDS.reportPhotoInput).setInputFiles(TEST_PHOTO);
    await this.page.getByTestId(TESTIDS.reportUseLocation).click();
    if (r.severity) await this.page.getByTestId(TESTIDS.reportSeverity).selectOption(r.severity);
  }

  /** Submit; the app runs the duplicate check first (03 §1). */
  async submit(): Promise<void> {
    await this.page.getByTestId(TESTIDS.reportSubmit).click();
  }

  async expectSubmitted(): Promise<void> {
    await expect(this.page.getByTestId(TESTIDS.submissionSuccess)).toBeVisible();
  }

  /** On the Duplicate Candidates screen, attach to the first (best-ranked) candidate. */
  async chooseSameIssueAsFirstCandidate(): Promise<void> {
    await expect(this.page.getByTestId(TESTIDS.duplicateCandidates)).toBeVisible();
    const first = this.page.getByTestId(TESTIDS.duplicateCandidate).first();
    await first.getByTestId(TESTIDS.duplicateSameIssue).click();
  }

  async openMyReports(): Promise<void> {
    await this.page.goto(ROUTES.myReports);
  }

  /** The newest of the citizen's reports (My Reports lists newest first). */
  latestReport() {
    return this.page.getByTestId(TESTIDS.myReport).first();
  }
}

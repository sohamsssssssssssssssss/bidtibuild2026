import type { Locator, Page } from "@playwright/test";
import type { Level } from "../../src/config/civic";
import { TESTIDS } from "../../src/config/testids";
import { AUTHORITY, ROUTES, TEST_PHOTO, expect } from "../support/judge";

/** Authority Command Center + Issue Workspace (03 §2), driven only through TESTIDS. */
export class AuthorityApp {
  constructor(readonly page: Page) {}

  async login(): Promise<void> {
    await this.page.goto(ROUTES.authorityLogin);
    await this.page.getByTestId(TESTIDS.authorityEmail).fill(AUTHORITY.email);
    await this.page.getByTestId(TESTIDS.authorityPassword).fill(AUTHORITY.password);
    await this.page.getByTestId(TESTIDS.authorityLogin).click();
    await expect(this.page.getByTestId(TESTIDS.queue)).toBeVisible();
  }

  queueRow(issueId: string): Locator {
    return this.page.locator(`[data-testid="${TESTIDS.queueRow}"][data-issue-id="${issueId}"]`);
  }

  /** Opens the workspace for an issue from the queue. */
  async openIssue(issueId: string): Promise<void> {
    await this.queueRow(issueId).click();
    await expect(this.page.getByTestId(TESTIDS.priorityBreakdown)).toBeVisible();
  }

  async setFinalPriority(level: Level): Promise<void> {
    await this.page.getByTestId(TESTIDS.finalPrioritySelect).selectOption(level);
    await this.page.getByTestId(TESTIDS.finalPrioritySave).click();
  }

  /** Assigns the preselected (suggested) department, or a named one. */
  async assign(departmentName?: string): Promise<void> {
    if (departmentName) {
      await this.page.getByTestId(TESTIDS.departmentSelect).selectOption({ label: departmentName });
    }
    await this.page.getByTestId(TESTIDS.assignSubmit).click();
  }

  async startWork(): Promise<void> {
    await this.page.getByTestId(TESTIDS.startWork).click();
  }

  async resolve(note: string): Promise<void> {
    await this.page.getByTestId(TESTIDS.resolvePhotoInput).setInputFiles(TEST_PHOTO);
    await this.page.getByTestId(TESTIDS.resolveNote).fill(note);
    await this.page.getByTestId(TESTIDS.resolveSubmit).click();
  }

  async expectStatus(status: string): Promise<void> {
    await expect(this.page.getByTestId(TESTIDS.issueStatus)).toContainText(status, { ignoreCase: true });
  }

  async openCriticalHotspot(): Promise<void> {
    await this.page.goto(ROUTES.authorityHome);
    await this.page.getByTestId(TESTIDS.hotspot).filter({ hasText: /CRITICAL/i }).first().click();
    await expect(this.page.getByTestId(TESTIDS.hotspotDetail)).toBeVisible();
  }
}

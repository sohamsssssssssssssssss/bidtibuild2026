/**
 * E2E selector contract: the `data-testid` values the Playwright judge-path test
 * (e2e/judge-path.spec.ts) drives the UI with. Put them on the matching elements as
 * `data-testid={TESTIDS.reportSubmit}` so the test survives copy and layout changes.
 *
 * Adding an id is free; renaming or removing one breaks the E2E test, so change both together.
 * Ids marked "(list item)" go on every repeated element; the test picks one by its text or index.
 */
export const TESTIDS = {
  // App shell (03 §5). The E2E test treats the UI as "built" once this renders on `/`.
  appShell: "app-shell",
  map: "city-map",
  demoDataBadge: "demo-data-badge",
  navMyReports: "nav-my-reports",

  // Report Issue (03 §1)
  reportOpen: "report-open",
  reportCategory: "report-category", // <select> or radio group; values are CATEGORIES from civic.ts
  reportDescription: "report-description",
  reportPhotoInput: "report-photo-input", // the <input type="file">
  reportUseLocation: "report-use-location", // "use my location" (GPS)
  reportSeverity: "report-severity", // optional; values are LEVELS
  reportSubmit: "report-submit",
  reportError: "report-error",

  // Duplicate Candidates (03 §1)
  duplicateCandidates: "duplicate-candidates",
  duplicateCandidate: "duplicate-candidate", // (list item)
  duplicateSameIssue: "duplicate-same-issue", // inside a candidate
  duplicateCreateNew: "duplicate-create-new",

  // Submission Success / Issue Detail / My Reports
  submissionSuccess: "submission-success",
  myReportsRefresh: "my-reports-refresh",
  myReport: "my-report", // (list item); carries data-issue-id
  issueStatus: "issue-status", // text is the IssueStatus value or its label
  resolutionEvidence: "resolution-evidence",

  // Authority (03 §2)
  authorityEmail: "authority-email",
  authorityPassword: "authority-password",
  authorityLogin: "authority-login",
  queue: "authority-queue",
  queueRow: "queue-row", // (list item); carries data-issue-id
  recommendedLabel: "recommended-label",
  priorityBreakdown: "priority-breakdown",
  reporterCount: "reporter-count",
  finalPrioritySelect: "final-priority-select",
  finalPrioritySave: "final-priority-save",
  departmentSelect: "department-select", // preselected to the suggestion
  assignSubmit: "assign-submit",
  startWork: "start-work",
  resolvePhotoInput: "resolve-photo-input",
  resolveNote: "resolve-note",
  resolveSubmit: "resolve-submit",

  // City Pulse (03 §3)
  hotspot: "hotspot", // (list item) in the overlay legend or list; carries data-hotspot-id
  hotspotDetail: "hotspot-detail",
  hotspotRegenerate: "hotspot-regenerate",
} as const;

export type TestId = (typeof TESTIDS)[keyof typeof TESTIDS];

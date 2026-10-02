// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DuplicateCandidates } from "../src/components/authority/duplicates/DuplicateCandidates";
import type { IssueDetail } from "../src/contracts/issues";
import type { DuplicateCandidate } from "../src/contracts/reports";

const sourceId = "11111111-1111-1111-1111-111111111111";
const targetId = "22222222-2222-2222-2222-222222222222";
const reportId = "33333333-3333-3333-3333-333333333333";
const now = "2026-10-02T10:00:00+00:00";

const source: IssueDetail = {
  id: sourceId,
  category: "POTHOLE",
  status: "REPORTED",
  citizen_severity: null,
  authority_severity: null,
  final_priority: null,
  lat: 19.0178,
  lng: 72.8478,
  department: null,
  assigned_at: null,
  sla_due_at: null,
  created_at: now,
  updated_at: now,
  resolved_at: null,
  merged_into_issue_id: null,
  is_seed: true,
  report_count: 1,
  photos: [
    {
      id: reportId,
      image_url: null,
      description: "Deep pothole",
      category: "POTHOLE",
      citizen_severity: null,
      created_at: now,
    },
  ],
  timeline: [],
  resolution_evidence: [],
};
const target: IssueDetail = {
  ...source,
  id: targetId,
  is_seed: false,
  report_count: 2,
  photos: [
    { ...source.photos[0]!, id: targetId, description: "Road surface damaged" },
  ],
};
const candidate: DuplicateCandidate = {
  id: targetId,
  category: "POTHOLE",
  status: "ASSIGNED",
  distance_m: 23.4,
  report_count: 2,
  image_url: null,
  created_at: now,
  match: "EXACT",
  lat: 19.0179,
  lng: 72.8479,
};
const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ data, error: null }),
});
const fail = (message: string, status = 500) => ({
  ok: false,
  status,
  json: async () => ({ data: null, error: { code: "INTERNAL", message } }),
});
let fetchMock: ReturnType<typeof vi.fn>;

function setup(
  options: {
    candidates?: DuplicateCandidate[];
    source?: IssueDetail;
    lookupError?: boolean;
    detailError?: boolean;
    merge?: (call: number) => object;
  } = {},
) {
  let mergeCalls = 0;
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === `/api/issues/${sourceId}`)
      return ok(options.source ?? source);
    if (input.startsWith("/api/duplicate-candidates?"))
      return options.lookupError
        ? fail("Lookup unavailable")
        : ok(options.candidates ?? [candidate]);
    if (input === `/api/issues/${targetId}`)
      return options.detailError ? fail("Detail unavailable") : ok(target);
    if (input === `/api/issues/${sourceId}/merge` && init?.method === "POST") {
      mergeCalls++;
      return (
        options.merge?.(mergeCalls) ?? {
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              source_issue_id: sourceId,
              target_issue_id: targetId,
              moved_report_ids: [reportId],
            },
            error: null,
          }),
        }
      );
    }
    throw new Error(`Unexpected request: ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return render(<DuplicateCandidates issueId={sourceId} />);
}

async function compare() {
  fireEvent.click(await screen.findByRole("button", { name: /Compare issue/ }));
  await screen.findByRole("heading", {
    name: "Could these be one civic issue?",
  });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("authority duplicate review", () => {
  it("renders actual candidate fields and a side-by-side comparison", async () => {
    setup();
    expect(await screen.findByText(/23 m away/)).toBeTruthy();
    await compare();
    expect(screen.getByRole("region", { name: /Current issue/ })).toBeTruthy();
    expect(
      screen.getByRole("region", { name: /Possible existing issue/ }),
    ).toBeTruthy();
    expect(screen.getByText("Deep pothole")).toBeTruthy();
    expect(screen.getByText("Road surface damaged")).toBeTruthy();
    expect(screen.getByText("Demo data")).toBeTruthy();
    expect(screen.getAllByText("Photo unavailable")).toHaveLength(2);
  });

  it("uses the seed fallback even when the API supplies a photo route", async () => {
    setup({
      source: {
        ...source,
        photos: [
          { ...source.photos[0]!, image_url: `/api/photos/report/${reportId}` },
        ],
      },
    });
    await compare();
    expect(screen.getAllByText("Photo unavailable")).toHaveLength(2);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("distinguishes an empty result from a failed lookup", async () => {
    setup({ candidates: [] });
    expect(
      await screen.findByText("No likely duplicate issues found."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a loading state while the lookup is pending", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(<DuplicateCandidates issueId={sourceId} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Checking nearby issues",
    );
  });

  it("shows a recoverable API error and retries", async () => {
    let attempts = 0;
    fetchMock = vi.fn(async (input: string) => {
      if (input === `/api/issues/${sourceId}`) return ok(source);
      attempts++;
      return attempts === 1 ? fail("Lookup unavailable") : ok([candidate]);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DuplicateCandidates issueId={sourceId} />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Lookup unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry lookup" }));
    expect(await screen.findByText(/23 m away/)).toBeTruthy();
  });

  it("requires a separate confirmation click before POST", async () => {
    setup();
    await compare();
    fireEvent.click(screen.getByRole("button", { name: "Review merge" }));
    expect(
      screen.getByRole("group", { name: "Confirm issue merge" }),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([path]) => String(path).endsWith("/merge")),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("group", { name: "Confirm issue merge" }),
    ).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([path]) => String(path).endsWith("/merge")),
    ).toHaveLength(0);
  });

  it("shows merge failure and allows retry without losing the comparison", async () => {
    setup({
      merge: (call) =>
        call === 1
          ? fail("Target issue is closed", 409)
          : {
              ok: true,
              status: 201,
              json: async () => ({
                data: {
                  source_issue_id: sourceId,
                  target_issue_id: targetId,
                  moved_report_ids: [reportId],
                },
                error: null,
              }),
            },
    });
    await compare();
    fireEvent.click(screen.getByRole("button", { name: "Review merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm merge" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Target issue is closed"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm merge" }));
    expect(
      await screen.findByText(/1 citizen report now belongs/),
    ).toBeTruthy();
  });

  it("validates successful merge data and uses the canonical source and target", async () => {
    setup();
    await compare();
    fireEvent.click(screen.getByRole("button", { name: "Review merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm merge" }));
    expect(await screen.findByText(/Issues merged/)).toBeTruthy();
    const [, init] = fetchMock.mock.calls.find(([path]) =>
      String(path).endsWith("/merge"),
    )!;
    expect(JSON.parse(init.body)).toEqual({ target_issue_id: targetId });
    expect(init.method).toBe("POST");
  });

  it("does not merge when simply selecting a candidate", async () => {
    setup();
    await compare();
    expect(
      fetchMock.mock.calls.filter(([path]) => String(path).endsWith("/merge")),
    ).toHaveLength(0);
  });

  it("handles unavailable photo and optional evidence without crashing", async () => {
    setup();
    await compare();
    expect(screen.getAllByText("Photo unavailable")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("keeps issues separate locally without a write", async () => {
    setup();
    await compare();
    fireEvent.click(screen.getByRole("button", { name: "Keep separate" }));
    expect(
      screen.queryByRole("heading", {
        name: "Could these be one civic issue?",
      }),
    ).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([path]) => String(path).endsWith("/merge")),
    ).toHaveLength(0);
  });
});

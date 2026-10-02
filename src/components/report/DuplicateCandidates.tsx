"use client";

import { CATEGORY_META, STATUS_META } from "@/config/civic";
import { TESTIDS } from "@/config/testids";
import type { DuplicateCandidate } from "@/contracts/reports";
import { Photo } from "@/components/Photo";
import "./report.css";

function distanceLabel(meters: number): string {
  return `${Math.max(0, Math.round(meters))} m away`;
}

export function DuplicateCandidates({
  candidates,
  busy,
  onSameIssue,
  onCreateNew,
  onBack,
}: {
  candidates: DuplicateCandidate[];
  busy: boolean;
  onSameIssue: (candidate: DuplicateCandidate) => void;
  onCreateNew: () => void;
  onBack: () => void;
}) {
  return (
    <section
      className="duplicate-panel"
      data-testid={TESTIDS.duplicateCandidates}
      aria-labelledby="duplicate-heading"
    >
      <h2 id="duplicate-heading">This may already be reported nearby</h2>
      <p className="duplicate-intro">
        Adding your report to an existing issue helps it get fixed faster. If
        none of these match, create a new issue.
      </p>
      <ul className="duplicate-list">
        {candidates.map((candidate) => {
          const category = CATEGORY_META[candidate.category].label;
          const status = STATUS_META[candidate.status];
          return (
            <li
              key={candidate.id}
              className="duplicate-card"
              data-testid={TESTIDS.duplicateCandidate}
              data-issue-id={candidate.id}
            >
              <div className="duplicate-photo">
                <Photo
                  src={candidate.image_url}
                  alt={`${category} reported nearby`}
                />
              </div>
              <div className="duplicate-body">
                <h3>{category}</h3>
                <p className="duplicate-meta">
                  <span
                    className="status-pill"
                    style={{ color: status.color, borderColor: status.color }}
                  >
                    {status.label}
                  </span>
                  <span>{distanceLabel(candidate.distance_m)}</span>
                  <span>
                    {candidate.report_count}{" "}
                    {candidate.report_count === 1 ? "report" : "reports"}
                  </span>
                </p>
                <p className="duplicate-match">
                  {candidate.match === "EXACT"
                    ? "Same category"
                    : "Related category"}
                </p>
                <button
                  type="button"
                  className="duplicate-primary"
                  data-testid={TESTIDS.duplicateSameIssue}
                  disabled={busy}
                  onClick={() => onSameIssue(candidate)}
                >
                  Same issue — add my report
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="duplicate-actions">
        <button
          type="button"
          className="duplicate-secondary"
          data-testid={TESTIDS.duplicateCreateNew}
          disabled={busy}
          onClick={onCreateNew}
        >
          Different issue — create new
        </button>
        <button
          type="button"
          className="duplicate-link"
          disabled={busy}
          onClick={onBack}
        >
          Back to edit
        </button>
      </div>
    </section>
  );
}

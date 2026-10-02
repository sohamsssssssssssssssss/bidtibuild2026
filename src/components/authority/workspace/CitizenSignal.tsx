"use client";

import { CATEGORY_META, STATUS_META, type EventType } from "@/config/civic";
import { TESTIDS } from "@/config/testids";
import type { IssueDetail, TimelineEvent } from "@/contracts/issues";
import type { AuthorityQueueRow } from "@/contracts/authority";
import { LevelChip } from "@/components/authority/chips";
import { dateTime } from "@/lib/authority/format";
import { Photo, plural } from "./shared";

const EVENT_LABELS: Record<EventType, string> = {
  CREATED: "Reported",
  SUPPORT_ADDED: "Supporting report added",
  SEVERITY_CONFIRMED: "Severity confirmed",
  PRIORITY_SET: "Priority set",
  ASSIGNED: "Assigned to a department",
  REASSIGNED: "Reassigned",
  STATUS_CHANGED: "Status changed",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  MERGED_INTO: "Merged into another issue",
  MERGED_FROM: "Absorbed a duplicate issue",
  REOPENED: "Reopened",
};

const ACTOR_LABELS = {
  CITIZEN: "Citizen",
  AUTHORITY: "Authority",
  SYSTEM: "System",
} as const;

function eventTitle(event: TimelineEvent): string {
  if (event.event_type === "STATUS_CHANGED" && event.to_status)
    return `Status → ${STATUS_META[event.to_status].label}`;
  return EVENT_LABELS[event.event_type];
}

export function CitizenSignal({
  issue,
  row,
}: {
  issue: IssueDetail;
  row: AuthorityQueueRow | null;
}) {
  return (
    <section
      className="ap-card ws-section ws-citizen"
      aria-labelledby="ws-citizen-title"
    >
      <p className="ap-kicker">Citizen signal</p>
      <h2 id="ws-citizen-title">What residents reported</h2>

      <dl className="ws-facts">
        <div>
          <dt>Reports</dt>
          <dd>{plural(issue.report_count, "report")}</dd>
        </div>
        <div>
          <dt>Reporters</dt>
          <dd>
            {row ? (
              <span data-testid={TESTIDS.reporterCount}>
                {row.distinct_reporter_count}{" "}
                {row.distinct_reporter_count === 1 ? "person" : "people"}{" "}
                reported this
              </span>
            ) : (
              <span className="ap-muted">Shown for open issues</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Citizen severity</dt>
          <dd>
            <LevelChip level={issue.citizen_severity} kind="citizen" />
          </dd>
        </div>
      </dl>

      <h3 className="ws-subhead">Photo evidence</h3>
      {issue.photos.length === 0 ? (
        <p className="ap-muted">No photos on this issue.</p>
      ) : (
        <ul className="ws-gallery">
          {issue.photos.map((photo) => (
            <li key={photo.id} className="ws-gallery-item">
              <Photo
                src={issue.is_seed ? null : photo.image_url}
                alt={`Reported ${CATEGORY_META[photo.category].label}`}
                className="ws-gallery-img"
              />
              <p className="ws-gallery-text">{photo.description}</p>
              <small className="ap-muted">
                {dateTime(photo.created_at)}
                {photo.citizen_severity && (
                  <>
                    {" · "}
                    <LevelChip level={photo.citizen_severity} kind="citizen" />
                  </>
                )}
              </small>
            </li>
          ))}
        </ul>
      )}

      <h3 className="ws-subhead">Timeline</h3>
      {issue.timeline.length === 0 ? (
        <p className="ap-muted">No updates yet.</p>
      ) : (
        <ol className="ws-timeline">
          {issue.timeline.map((event) => (
            <li key={event.id} data-actor={event.actor}>
              <span
                className={`ws-actor ws-actor-${event.actor.toLowerCase()}`}
              >
                {ACTOR_LABELS[event.actor]}
              </span>
              <strong>{eventTitle(event)}</strong>
              <small className="ap-muted">{dateTime(event.created_at)}</small>
              {event.note && <p className="ws-note">{event.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import { CATEGORY_META, CITY_PULSE_CONFIG, LEVEL_META } from "@/config/civic";
import { TESTIDS } from "@/config/testids";
import type { Hotspot } from "@/contracts/hotspots";
import { CategoryChip, LevelChip } from "@/components/authority/chips";
import { dateTime } from "@/lib/authority/format";

const MEMBER_LINKS = 6;

export function trendLabel(percent: number): string {
  const rounded = Math.round(percent);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

export function expectedLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function HotspotList({
  hotspots,
  selectedId,
  onSelect,
}: {
  hotspots: Hotspot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ol className="cp-list" aria-label="Active hotspots">
      {hotspots.map((hotspot) => {
        const selected = hotspot.id === selectedId;
        return (
          <li key={hotspot.id}>
            <button
              type="button"
              className={`cp-item${selected ? " cp-item-selected" : ""}`}
              style={
                {
                  "--level": LEVEL_META[hotspot.severity].color,
                } as React.CSSProperties
              }
              aria-pressed={selected}
              data-testid={TESTIDS.hotspot}
              data-hotspot-id={hotspot.id}
              onClick={() => onSelect(hotspot.id)}
            >
              <span className="cp-item-top">
                <CategoryChip category={hotspot.category} />
                <LevelChip level={hotspot.severity} kind="recommended" />
                {/* E2E matches the raw enum (e.g. CRITICAL); keep it in the text. */}
                <span className="ap-visually-hidden">{hotspot.severity}</span>
              </span>
              <span className="cp-item-stats">
                <span>
                  <strong>{hotspot.current_issue_count}</strong> new vs{" "}
                  {expectedLabel(hotspot.expected_current_count)} expected
                </span>
                <span className="cp-trend">
                  {trendLabel(hotspot.trend_percent)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function HotspotDetail({ hotspot }: { hotspot: Hotspot }) {
  const members = hotspot.member_issue_ids;
  const shown = members.slice(0, MEMBER_LINKS);
  return (
    <section
      className="ap-card cp-detail"
      data-testid={TESTIDS.hotspotDetail}
      aria-labelledby="cp-detail-title"
    >
      <p className="ap-kicker">Selected hotspot · recommendation</p>
      <div className="cp-detail-head">
        <h2 id="cp-detail-title">
          {CATEGORY_META[hotspot.category].label} cluster
        </h2>
        <LevelChip level={hotspot.severity} kind="recommended" />
      </div>
      <p className="cp-codes ap-muted">
        Category <code>{hotspot.category}</code> · Severity{" "}
        <code>{hotspot.severity}</code>
      </p>
      <p className="cp-explanation">{hotspot.explanation}</p>

      <dl className="cp-stats">
        <div>
          <dt>Current ({CITY_PULSE_CONFIG.current_window_hours} h)</dt>
          <dd>{hotspot.current_issue_count}</dd>
        </div>
        <div>
          <dt>Baseline ({CITY_PULSE_CONFIG.baseline_window_hours} h)</dt>
          <dd>{hotspot.baseline_issue_count}</dd>
        </div>
        <div>
          <dt>Expected now</dt>
          <dd>{expectedLabel(hotspot.expected_current_count)}</dd>
        </div>
        <div>
          <dt>Trend</dt>
          <dd>{trendLabel(hotspot.trend_percent)}</dd>
        </div>
      </dl>

      <p className="cp-meta ap-muted">
        Window {dateTime(hotspot.window_start)} – {dateTime(hotspot.window_end)}
        <br />
        Generated {dateTime(hotspot.generated_at)}
      </p>

      <h3 className="cp-members-title">
        {members.length} member {members.length === 1 ? "issue" : "issues"}
      </h3>
      {members.length > 0 ? (
        <ol className="cp-members">
          {shown.map((issueId, index) => (
            <li key={issueId}>
              <span className="ap-muted">Issue {index + 1}</span>
              <Link href={`/authority/issues/${encodeURIComponent(issueId)}`}>
                Open issue
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ap-muted">No visible member issues.</p>
      )}
      {members.length > shown.length && (
        <p className="ap-muted cp-more">
          +{members.length - shown.length} more in this cluster
        </p>
      )}
    </section>
  );
}

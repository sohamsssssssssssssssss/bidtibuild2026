import {
  CATEGORY_META,
  LEVEL_META,
  STATUS_META,
  type Category,
  type IssueStatus,
  type Level,
} from "@/config/civic";
import { TESTIDS } from "@/config/testids";
import { CATEGORY_ICONS } from "@/components/map/categoryIcons";

/** Status chip. Carries the issueStatus test id only where `testId` is set. */
export function StatusChip({
  status,
  testId = false,
}: {
  status: IssueStatus;
  testId?: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className="ap-chip ap-status"
      style={{ "--chip": meta.color } as React.CSSProperties}
      data-status={status}
      data-testid={testId ? TESTIDS.issueStatus : undefined}
    >
      <span className="ap-dot" aria-hidden="true" />
      {meta.label}
      {testId && (
        // The E2E contract matches the raw enum (e.g. IN_PROGRESS); keep it in the text, visually hidden.
        <span className="ap-visually-hidden" aria-hidden="true">
          {status}
        </span>
      )}
    </span>
  );
}

export function CategoryChip({ category }: { category: Category }) {
  return (
    <span className="ap-category">
      <span className="ap-category-icon" aria-hidden="true">
        {CATEGORY_ICONS[category]}
      </span>
      {CATEGORY_META[category].label}
    </span>
  );
}

/**
 * A level (severity or priority). `kind` changes the framing so the three
 * voices never look alike: citizen = outline, recommended = dashed, authority = solid.
 */
export function LevelChip({
  level,
  kind,
  testId,
}: {
  level: Level | null;
  kind: "citizen" | "recommended" | "authority";
  testId?: string;
}) {
  if (!level)
    return (
      <span
        className={`ap-level ap-level-${kind} ap-level-empty`}
        data-testid={testId}
      >
        {kind === "authority" ? "Not set" : "—"}
      </span>
    );
  return (
    <span
      className={`ap-level ap-level-${kind}`}
      style={{ "--level": LEVEL_META[level].color } as React.CSSProperties}
      data-level={level}
      data-testid={testId}
    >
      {LEVEL_META[level].label}
    </span>
  );
}

export function DemoTag() {
  return <span className="demo-tag">Demo data</span>;
}

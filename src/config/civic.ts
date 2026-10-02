/**
 * CivicPulse AI — shared constants.
 *
 * docs/02_TECHNICAL_SPEC.md §2: every constant in 02 is implemented exactly once,
 * here. Nothing else in the codebase (TS or SQL) may hard-code these numbers.
 *
 * - SQL functions never hard-code values: the server passes the relevant
 *   `*_CONFIG` object below as the `p_config jsonb` argument. Keys are
 *   snake_case so the objects serialise straight to jsonb.
 * - Two exceptions live in migrations and are mirrored here as TS:
 *   enum values (§3.1, 04 §1/§2) and allowed status transitions (§4).
 *   SQL enforces them; an integration test checks that SQL and TS agree.
 */

// ---------------------------------------------------------------------------
// Enums (mirrored from migrations; 04 §1, §2)
// ---------------------------------------------------------------------------

/** 02 §3.1 — Postgres enum `issue_category`. */
export const CATEGORIES = [
  "POTHOLE",
  "STREETLIGHT",
  "GARBAGE",
  "WATER_LEAK",
  "DRAINAGE",
  "WATERLOGGING",
  "FOOTPATH",
  "PUBLIC_PROPERTY",
  "OTHER",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** 04 §1 — Postgres enum `issue_status`. `REOPENED` is used only once the reopen stretch ships. */
export const ISSUE_STATUSES = [
  "REPORTED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "REJECTED",
  "MERGED",
  "REOPENED",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** 04 §1 — Postgres enum `level`: severity, final priority and hotspot severity. Ordered low → high. */
export const LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Level = (typeof LEVELS)[number];

/** 04 §1 — Postgres enum `user_role`. */
export const USER_ROLES = ["AUTHORITY"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** 04 §2 — `issue_events.event_type` check constraint. */
export const EVENT_TYPES = [
  "CREATED",
  "SUPPORT_ADDED",
  "SEVERITY_CONFIRMED",
  "PRIORITY_SET",
  "ASSIGNED",
  "REASSIGNED",
  "STATUS_CHANGED",
  "RESOLVED",
  "REJECTED",
  "MERGED_INTO",
  "MERGED_FROM",
  "REOPENED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** 02 §5.4 — where the effective severity came from. */
export const SEVERITY_SOURCES = ["AUTHORITY", "CITIZEN", "DEFAULT"] as const;
export type SeveritySource = (typeof SEVERITY_SOURCES)[number];

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

/**
 * Stretch features. Typed as `boolean` (not literal `false`) so code guarded
 * by a flag still type-checks while the flag is off.
 */
export const FEATURES: { readonly reopen: boolean } = {
  /** 02 §4 "Stretch (reopen)". */
  reopen: false,
};

// ---------------------------------------------------------------------------
// Status sets
// ---------------------------------------------------------------------------

/**
 * Every status an issue can have while it is "open" (unresolved, not rejected,
 * not merged). This is the type universe; `REOPENED` only appears in data once
 * the reopen stretch ships. Use `openStatuses()` for the flag-aware runtime list.
 */
export const OPEN_STATUSES = ["REPORTED", "ASSIGNED", "IN_PROGRESS", "REOPENED"] as const;
export type OpenStatus = (typeof OPEN_STATUSES)[number];

/** Open statuses honouring the reopen flag (02 §3.3, §6.2: "plus REOPENED once built"). */
export function openStatuses(opts: { reopenEnabled?: boolean } = {}): OpenStatus[] {
  const reopen = opts.reopenEnabled ?? FEATURES.reopen;
  return OPEN_STATUSES.filter((s) => reopen || s !== "REOPENED");
}

/**
 * Statuses shown as markers on the public map (`GET /api/issues`).
 * REJECTED is hidden publicly (06 §21); MERGED issues live on as their target.
 */
export const MAP_STATUSES = ["REPORTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "REOPENED"] as const;
export type MapStatus = (typeof MAP_STATUSES)[number];

/** Status a new issue is created with (02 §4, event `CREATED`). */
export const INITIAL_STATUS = "REPORTED" satisfies IssueStatus;

// ---------------------------------------------------------------------------
// Allowed status transitions (02 §4)
//
// SQL (`assign_issue`, `transition_issue`, `resolve_issue`, `merge_issue`)
// ENFORCES these. This copy only drives the UI (which buttons to show).
// An integration test checks the two agree (02 §15). Change both together.
// ---------------------------------------------------------------------------

export const TRANSITION_ACTORS = ["CITIZEN", "AUTHORITY"] as const;
export type TransitionActor = (typeof TRANSITION_ACTORS)[number];

/** Which API route performs the transition. */
export type TransitionAction =
  | "ASSIGN" // POST  /api/issues/:id/assign
  | "STATUS" // PATCH /api/issues/:id/status
  | "RESOLVE" // POST  /api/issues/:id/resolution
  | "MERGE"; // POST  /api/issues/:id/merge

export interface StatusTransition {
  readonly from: readonly IssueStatus[];
  readonly to: IssueStatus;
  readonly actors: readonly TransitionActor[];
  readonly action: TransitionAction;
  readonly event: EventType;
  /** 02 §4 "reason required". */
  readonly requiresNote: boolean;
  /** Behind `FEATURES.reopen`. */
  readonly stretch: boolean;
  /** Human-readable condition from 02 §4 (enforced in SQL). */
  readonly condition: string;
}

export const STATUS_TRANSITIONS = [
  {
    from: ["REPORTED"],
    to: "ASSIGNED",
    actors: ["AUTHORITY"],
    action: "ASSIGN",
    event: "ASSIGNED",
    requiresNote: false,
    stretch: false,
    condition: "department given",
  },
  {
    from: ["ASSIGNED", "IN_PROGRESS"],
    to: "ASSIGNED",
    actors: ["AUTHORITY"],
    action: "ASSIGN",
    event: "REASSIGNED",
    requiresNote: false,
    stretch: false,
    condition: "a different department",
  },
  {
    from: ["ASSIGNED"],
    to: "IN_PROGRESS",
    actors: ["AUTHORITY"],
    action: "STATUS",
    event: "STATUS_CHANGED",
    requiresNote: false,
    stretch: false,
    condition: "",
  },
  {
    from: ["IN_PROGRESS"],
    to: "RESOLVED",
    actors: ["AUTHORITY"],
    action: "RESOLVE",
    event: "RESOLVED",
    requiresNote: false,
    stretch: false,
    condition: "evidence row inserted in the same transaction",
  },
  {
    from: ["REPORTED", "ASSIGNED"],
    to: "REJECTED",
    actors: ["AUTHORITY"],
    action: "STATUS",
    event: "REJECTED",
    requiresNote: true,
    stretch: false,
    condition: "reason required",
  },
  {
    from: ["REPORTED", "ASSIGNED", "IN_PROGRESS"],
    to: "MERGED",
    actors: ["AUTHORITY"],
    action: "MERGE",
    event: "MERGED_INTO",
    requiresNote: false,
    stretch: false,
    condition: "02 §3.7: target is a different open issue",
  },
  // ---- Stretch (reopen) — only active when FEATURES.reopen ----
  {
    from: ["RESOLVED"],
    to: "REOPENED",
    actors: ["CITIZEN", "AUTHORITY"],
    action: "STATUS",
    event: "REOPENED",
    requiresNote: true,
    stretch: true,
    condition: "citizen with a report on the issue within REOPEN_WINDOW_DAYS of resolved_at, or authority; reason required",
  },
  {
    from: ["REOPENED"],
    to: "ASSIGNED",
    actors: ["AUTHORITY"],
    action: "ASSIGN",
    event: "ASSIGNED",
    requiresNote: false,
    stretch: true,
    condition: "department given",
  },
  {
    from: ["REOPENED"],
    to: "IN_PROGRESS",
    actors: ["AUTHORITY"],
    action: "STATUS",
    event: "STATUS_CHANGED",
    requiresNote: false,
    stretch: true,
    condition: "",
  },
  {
    from: ["REOPENED"],
    to: "REJECTED",
    actors: ["AUTHORITY"],
    action: "STATUS",
    event: "REJECTED",
    requiresNote: true,
    stretch: true,
    condition: "reason required",
  },
  {
    from: ["REOPENED"],
    to: "MERGED",
    actors: ["AUTHORITY"],
    action: "MERGE",
    event: "MERGED_INTO",
    requiresNote: false,
    stretch: true,
    condition: "02 §3.7: target is a different open issue",
  },
] as const satisfies readonly StatusTransition[];

export interface TransitionQuery {
  /** Defaults to `FEATURES.reopen`. */
  reopenEnabled?: boolean;
  /** Only rows this actor may perform. Omit for any actor. */
  actor?: TransitionActor;
  /** Only rows performed by this route. */
  action?: TransitionAction;
}

/** Every transition row available from `from` (expanded; same-status REASSIGN included). */
export function allowedTransitions(from: IssueStatus, q: TransitionQuery = {}): StatusTransition[] {
  const reopen = q.reopenEnabled ?? FEATURES.reopen;
  return (STATUS_TRANSITIONS as readonly StatusTransition[]).filter(
    (t) =>
      (reopen || !t.stretch) &&
      t.from.includes(from) &&
      (q.actor === undefined || t.actors.includes(q.actor)) &&
      (q.action === undefined || t.action === q.action),
  );
}

/** Distinct target statuses reachable from `from`. ASSIGNED→ASSIGNED (reassign) is included. */
export function allowedNextStatuses(from: IssueStatus, q: TransitionQuery = {}): IssueStatus[] {
  return [...new Set(allowedTransitions(from, q).map((t) => t.to))];
}

export function findTransition(
  from: IssueStatus,
  to: IssueStatus,
  q: TransitionQuery = {},
): StatusTransition | undefined {
  return allowedTransitions(from, q).find((t) => t.to === to);
}

export function canTransition(from: IssueStatus, to: IssueStatus, q: TransitionQuery = {}): boolean {
  return findTransition(from, to, q) !== undefined;
}

/** Targets accepted by `PATCH /api/issues/:id/status` (derived from the table: IN_PROGRESS, REJECTED, REOPENED). */
export const STATUS_PATCH_TARGETS = ["IN_PROGRESS", "REJECTED", "REOPENED"] as const satisfies readonly Extract<
  (typeof STATUS_TRANSITIONS)[number],
  { action: "STATUS" }
>["to"][];
export type StatusPatchTarget = (typeof STATUS_PATCH_TARGETS)[number];

/** Targets whose transition requires a note/reason (02 §4): REJECTED, REOPENED. */
export const NOTE_REQUIRED_STATUSES = ["REJECTED", "REOPENED"] as const satisfies readonly Extract<
  (typeof STATUS_TRANSITIONS)[number],
  { requiresNote: true }
>["to"][];

// ---------------------------------------------------------------------------
// Shared geometry constants
// ---------------------------------------------------------------------------

/**
 * 02 §3.2 — per-category radius in metres. Used for duplicate candidates
 * (DUPLICATE_CONFIG) and recurrence (PRIORITY_CONFIG §5.8).
 */
export const CATEGORY_RADIUS_M = {
  STREETLIGHT: 30,
  POTHOLE: 50,
  FOOTPATH: 50,
  PUBLIC_PROPERTY: 50,
  OTHER: 50,
  GARBAGE: 75,
  WATER_LEAK: 75,
  DRAINAGE: 150,
  WATERLOGGING: 150,
} as const satisfies Record<Category, number>;

/** 02 §3.4 — cross-category matching only inside one family. */
export const COMPATIBLE_CATEGORY_FAMILIES = [
  ["DRAINAGE", "WATERLOGGING", "WATER_LEAK"],
] as const satisfies readonly (readonly Category[])[];

// ---------------------------------------------------------------------------
// p_config objects passed to SQL functions
// ---------------------------------------------------------------------------

/**
 * Passed as `p_config` to `duplicate_candidates(p_lat, p_lng, p_category, p_config)`.
 * Implements 02 §3.2 (radii), §3.3 (eligibility), §3.4 (families), §3.5 (max results).
 * Ranking order (§3.5) is fixed in SQL: exact before family, distance asc, newest first.
 */
export const DUPLICATE_CONFIG = {
  /** §3.2 — radius of the NEW report's category, metres. */
  radius_m_by_category: CATEGORY_RADIUS_M,
  /** §3.3 — candidates must be created within this many days. */
  window_days: 30,
  /** §3.3 — candidate statuses (REOPENED added once the stretch ships). */
  candidate_statuses: openStatuses(),
  /** §3.4 — each inner array is one compatible family. Exact category always matches. */
  compatible_families: COMPATIBLE_CATEGORY_FAMILIES,
  /** §3.5 — maximum candidates returned. */
  max_candidates: 5,
} as const;
export type DuplicateConfig = typeof DUPLICATE_CONFIG;

/**
 * Passed as `p_config` to `authority_queue(p_config, p_filters)`.
 * Implements 02 §5.3–§5.9. SQL owns all factor math; TS only maps a score to a label.
 *
 *   severity   = severity_values[effective severity]  (authority → citizen → default_severity)
 *   support    = min(factor_max, support_multiplier * log2(1 + distinct reporters))
 *   age        = min(factor_max, hours_since_created / age_full_hours * factor_max)
 *   location   = max intersecting risk_zones.risk_value, else default_location_risk
 *   recurrence = min(factor_max, recurrence_points_per_issue * recurrence_count)
 *   score      = Σ weights[k] * factor_k
 */
export const PRIORITY_CONFIG = {
  /** §5.3 */
  weights: {
    severity: 0.35,
    support: 0.2,
    age: 0.15,
    location_risk: 0.2,
    recurrence: 0.1,
  },
  /** §5.4 */
  severity_values: { LOW: 25, MEDIUM: 50, HIGH: 75, CRITICAL: 100 } satisfies Record<Level, number>,
  /** §5.4 — used when neither authority nor citizen severity is set (source DEFAULT). */
  default_severity: "MEDIUM" satisfies Level,
  /** Cap applied to every factor (support, age, recurrence). */
  factor_max: 100,
  /** §5.5 */
  support_multiplier: 25,
  /** §5.6 — age factor reaches factor_max at this many hours (7 days). */
  age_full_hours: 168,
  /** §5.7 */
  default_location_risk: 25,
  /** §5.8 — RESOLVED issues of the same exact category within the radius, resolved within this window. */
  recurrence_window_days: 90,
  /** §5.8 */
  recurrence_points_per_issue: 50,
  /** §5.8 → §3.2 */
  recurrence_radius_m_by_category: CATEGORY_RADIUS_M,
  /** §5.9 — lower bound (inclusive) of each label; below MEDIUM is LOW. */
  label_thresholds: { MEDIUM: 25, HIGH: 40, CRITICAL: 55 },
  /** Statuses the queue returns when no status filter is given ("one row per open issue", 04 §3). */
  queue_statuses: openStatuses(),
} as const;
export type PriorityConfig = typeof PRIORITY_CONFIG;

/** 02 §5.9 — label for a recommended-priority score. Factor math stays in SQL. */
export function priorityLabel(score: number): Level {
  const t = PRIORITY_CONFIG.label_thresholds;
  if (score >= t.CRITICAL) return "CRITICAL";
  if (score >= t.HIGH) return "HIGH";
  if (score >= t.MEDIUM) return "MEDIUM";
  return "LOW";
}

const CITY_PULSE_CURRENT_HOURS = 2;
const CITY_PULSE_BASELINE_HOURS = 6;

/**
 * Passed as `p_config` to `regenerate_city_pulse(p_config)`.
 * Implements 02 §6.2–§6.6.
 *
 *   input     = issues in input_statuses created in the last input_window_hours
 *   clusters  = ST_ClusterDBSCAN(ST_Transform(geom, cluster_srid), eps := cluster_eps_m,
 *               minpoints := cluster_min_points) OVER (PARTITION BY category)
 *   expected  = baseline_count / baseline_divisor
 *   active    iff current_count >= min_current_count
 *   trend %   = (current - expected) / max(expected, expected_floor) * 100
 *   severity  = trend_thresholds_percent (CRITICAL also needs current >= critical_min_current_count, else HIGH)
 *   geometry  = ST_Buffer(ST_ConvexHull(ST_Collect(members in cluster_srid)), buffer_m) → 4326
 */
export const CITY_PULSE_CONFIG = {
  /** §6.2 — current + baseline windows (8 h). */
  input_window_hours: CITY_PULSE_CURRENT_HOURS + CITY_PULSE_BASELINE_HOURS,
  /** §6.2 */
  input_statuses: openStatuses(),
  /** §6.3 — metre-based UTM zone 43N for Mumbai. */
  cluster_srid: 32643,
  /** §6.3 */
  cluster_eps_m: 300,
  /** §6.3 */
  cluster_min_points: 4,
  /** §6.4 */
  current_window_hours: CITY_PULSE_CURRENT_HOURS,
  /** §6.4 — the window preceding the current one. */
  baseline_window_hours: CITY_PULSE_BASELINE_HOURS,
  /** §6.4 — baseline_window_hours / current_window_hours (= 3). */
  baseline_divisor: CITY_PULSE_BASELINE_HOURS / CITY_PULSE_CURRENT_HOURS,
  /** §6.4 — `max(expected_current, 1)` in the trend denominator. */
  expected_floor: 1,
  /** §6.4 — a cluster is an active hotspot only if current_count >= this. */
  min_current_count: 4,
  /** §6.5 — lower bound (inclusive) of each severity in trend percent; below MEDIUM is LOW. */
  trend_thresholds_percent: { MEDIUM: 50, HIGH: 100, CRITICAL: 200 },
  /** §6.5 — CRITICAL also needs current_count >= this; otherwise capped at HIGH. */
  critical_min_current_count: 6,
  /** §6.6 */
  buffer_m: 50,
} as const;
export type CityPulseConfig = typeof CITY_PULSE_CONFIG;

/**
 * Passed as `p_config` to `create_report(...)` and `add_supporting_report(...)`.
 * Implements 02 §9. Counts come from `reports` rows over a rolling window.
 */
export const RATE_LIMIT_CONFIG = {
  window_hours: 1,
  max_reports_per_user: 5,
  max_reports_per_ip_hash: 100,
} as const;
export type RateLimitConfig = typeof RATE_LIMIT_CONFIG;

/**
 * Passed as `p_config` to `resolution_stats(p_config)` (GET /api/stats/resolution, 02 §13).
 * Report-to-resolution time per category over issues resolved within the window, plus the
 * current open count. A demo card, not the broad analytics that 01 §2 leaves as stretch.
 */
export const RESOLUTION_STATS_CONFIG = {
  window_days: 90,
  open_statuses: openStatuses(),
} as const;
export type ResolutionStatsConfig = typeof RESOLUTION_STATS_CONFIG;

// ---------------------------------------------------------------------------
// Other constants
// ---------------------------------------------------------------------------

/** 02 §4 (stretch) — a citizen may reopen within this many days of `resolved_at`. */
export const REOPEN_WINDOW_DAYS = 7;

/** 02 §8 — `departments.sla_hours` seed default. Seed only; SLA math uses the department row. */
export const SLA_DEFAULT_HOURS = 72;

/** 02 §9 — `reporter_ip_hash = SHA-256(client IP + IP_HASH_SALT)`. */
export const IP_HASH_ALGORITHM = "SHA-256";

const MB = 1024 * 1024;

/** 02 §10.1 — in-browser photo processing. */
export const PHOTO_CONFIG = {
  /** `<input accept>` */
  accept: "image/*",
  /** Reject originals over this size before decoding. */
  max_original_bytes: 10 * MB,
  /** Longest edge after resize. */
  max_edge_px: 1600,
  output_mime_type: "image/jpeg",
  jpeg_quality: 0.8,
  /** Target output size (soft). The bucket limit below is the hard limit. */
  target_max_bytes: 1 * MB,
  /** Object path is `{uid}/{uuid}.jpg`. */
  file_extension: ".jpg",
} as const;

/** 02 §10.2 — Storage bucket names. */
export const STORAGE_BUCKETS = {
  reportPhotos: "report-photos",
  resolutionPhotos: "resolution-photos",
} as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/** 02 §10.2 — applies to both buckets. */
export const STORAGE_BUCKET_LIMITS = {
  file_size_limit_bytes: 2 * MB,
  allowed_mime_types: ["image/jpeg"],
} as const;

/**
 * Text-field limits used by the Zod contracts. Not specified in 02; chosen
 * here so they exist in exactly one place. Inputs are trimmed before checking.
 */
export const TEXT_LIMITS = {
  description: { min: 1, max: 2000 },
  note: { min: 1, max: 1000 },
} as const;

// ---------------------------------------------------------------------------
// Map (02 §12)
// ---------------------------------------------------------------------------

/** OpenFreeMap vector style. Never depend on public OSM raster tiles (06 §40). */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Default viewport: Mumbai. */
export const MAP_DEFAULT_VIEW = {
  center: { lng: 72.865, lat: 19.045 },
  zoom: 12,
} as const;

/**
 * 02 §14 — judge-demo pothole location (Dadar, on an arterial road). The seed's
 * "Demo arterial road" risk zone (risk_value 80) contains it; a test asserts so.
 */
export const DEMO_SPOT = { lat: 19.0178, lng: 72.8478 } as const;

/**
 * Seed only — centre of the seeded City Pulse DRAINAGE scenario (Kurla),
 * well away from DEMO_SPOT (02 §14). App code must not use it.
 */
export const CITY_PULSE_DEMO_CENTER = { lat: 19.0728, lng: 72.8826 } as const;

// ---------------------------------------------------------------------------
// Display metadata (UI legend + seed)
// ---------------------------------------------------------------------------

export const CATEGORY_META = {
  POTHOLE: { label: "Pothole" },
  STREETLIGHT: { label: "Streetlight" },
  GARBAGE: { label: "Garbage" },
  WATER_LEAK: { label: "Water leak" },
  DRAINAGE: { label: "Drainage" },
  WATERLOGGING: { label: "Waterlogging" },
  FOOTPATH: { label: "Footpath" },
  PUBLIC_PROPERTY: { label: "Public property" },
  OTHER: { label: "Other" },
} as const satisfies Record<Category, { label: string }>;

export const STATUS_META = {
  REPORTED: { label: "Reported", color: "#ef4444" },
  ASSIGNED: { label: "Assigned", color: "#f59e0b" },
  IN_PROGRESS: { label: "In progress", color: "#3b82f6" },
  RESOLVED: { label: "Resolved", color: "#22c55e" },
  REJECTED: { label: "Rejected", color: "#6b7280" },
  MERGED: { label: "Merged", color: "#8b5cf6" },
  REOPENED: { label: "Reopened", color: "#ec4899" },
} as const satisfies Record<IssueStatus, { label: string; color: string }>;

export const LEVEL_META = {
  LOW: { label: "Low", color: "#64748b" },
  MEDIUM: { label: "Medium", color: "#eab308" },
  HIGH: { label: "High", color: "#f97316" },
  CRITICAL: { label: "Critical", color: "#dc2626" },
} as const satisfies Record<Level, { label: string; color: string }>;

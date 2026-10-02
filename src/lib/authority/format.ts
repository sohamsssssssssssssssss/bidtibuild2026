/** Display helpers for the authority workspace. Pure; no data is invented. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "5m", "3h", "2d" since `iso`, relative to `now`. */
export function ageLabel(iso: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(iso).getTime());
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/** SLA state from `sla_due_at` (null when the issue has no department yet). */
export function slaState(
  dueIso: string | null,
  now: number = Date.now(),
): { label: string; overdue: boolean } | null {
  if (!dueIso) return null;
  const ms = new Date(dueIso).getTime() - now;
  const span = ageLabel(new Date(now - Math.abs(ms)).toISOString(), now);
  return ms < 0
    ? { label: `SLA overdue ${span}`, overdue: true }
    : { label: `SLA due in ${span}`, overdue: false };
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function coords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

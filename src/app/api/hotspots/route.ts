/** GET /api/hotspots — stub until Phase 5 (City Pulse); see docs/WORK_SPLIT.md. */
import { notImplemented } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return notImplemented("GET /api/hotspots", 5);
}

/** GET /api/authority/queue — stub until Phase 2 (Authority workflow); see docs/WORK_SPLIT.md. */
import { notImplemented } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return notImplemented("GET /api/authority/queue", 2);
}

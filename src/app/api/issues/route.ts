/** GET /api/issues — public map markers inside a bbox (02 §12, §13). */
import { issuesQuerySchema, issuesResponseSchema } from "@/contracts/issues";
import { callRpc, parseDbResult, parseQuery, respondOk, withApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req) => {
  const q = parseQuery(req, issuesQuerySchema);
  const rows = await callRpc("map_issues", {
    p_min_lng: q.bbox.minLng,
    p_min_lat: q.bbox.minLat,
    p_max_lng: q.bbox.maxLng,
    p_max_lat: q.bbox.maxLat,
    p_categories: q.category ?? null,
    p_statuses: q.status ?? null, // null = every map status; SQL always drops REJECTED/MERGED
  });
  return respondOk(parseDbResult(issuesResponseSchema, rows, "map_issues"));
});

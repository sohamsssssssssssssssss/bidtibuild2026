/**
 * GET /api/duplicate-candidates?lat=..&lng=..&category=.. — 02 §3.3–3.5, §13.
 * Any signed-in caller (anonymous citizens, and authorities for the merge
 * picker, which drops the issue itself client-side). Eligibility, radii and
 * ranking come from DUPLICATE_CONFIG; SQL applies them. No confidence score (06 rule 30).
 */
import { DUPLICATE_CONFIG } from "@/config/civic";
import { duplicateCandidatesQuerySchema, duplicateCandidatesResponseSchema } from "@/contracts/reports";
import {
  callRpc,
  duplicateCandidateRowsSchema,
  parseDbResult,
  parseQuery,
  requireUser,
  respondOk,
  toDuplicateCandidates,
  withApi,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req) => {
  await requireUser(req);
  const query = parseQuery(req, duplicateCandidatesQuerySchema);

  const raw = await callRpc("duplicate_candidates", {
    p_lat: query.lat,
    p_lng: query.lng,
    p_category: query.category,
    p_config: DUPLICATE_CONFIG,
  });
  const rows = parseDbResult(duplicateCandidateRowsSchema, raw, "duplicate_candidates");

  const data = parseDbResult(
    duplicateCandidatesResponseSchema,
    toDuplicateCandidates(rows),
    "GET /api/duplicate-candidates",
  );
  return respondOk(data);
});

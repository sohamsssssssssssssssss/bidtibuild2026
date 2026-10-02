/**
 * GET /api/authority/queue — authority only (02 §5, §13). Wraps
 * `authority_queue(p_config, p_filters)`; queue v1 (Phase 2) is ordered by
 * final priority then age, with the recommendation fields null until Phase 4.
 */
import { PRIORITY_CONFIG } from "@/config/civic";
import {
  authorityQueueQuerySchema,
  authorityQueueResponseSchema,
  toAuthorityQueueFilters,
} from "@/contracts/authority";
import { callRpc, parseDbResult, parseQuery, requireAuthority, respondOk, withApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req) => {
  await requireAuthority(req);
  const query = parseQuery(req, authorityQueueQuerySchema);

  const raw = await callRpc(
    "authority_queue",
    { p_config: PRIORITY_CONFIG, p_filters: toAuthorityQueueFilters(query) },
    { errors: { VALIDATION_FAILED: "Some of the queue filters aren't valid. Please check them and try again." } },
  );
  return respondOk(parseDbResult(authorityQueueResponseSchema, raw, "authority_queue"));
});

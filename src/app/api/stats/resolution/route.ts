/**
 * GET /api/stats/resolution — public, no auth (02 §13). Report-to-resolution time per category
 * plus the current open count; counts only. RESOLUTION_STATS_CONFIG sets the window.
 */
import { RESOLUTION_STATS_CONFIG } from "@/config/civic";
import { resolutionStatsResponseSchema } from "@/contracts/stats";
import { callRpc, parseDbResult, respondOk, withApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const raw = await callRpc("resolution_stats", { p_config: RESOLUTION_STATS_CONFIG });
  return respondOk(parseDbResult(resolutionStatsResponseSchema, raw, "resolution_stats"));
});

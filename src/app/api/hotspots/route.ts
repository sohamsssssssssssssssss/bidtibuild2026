/**
 * GET /api/hotspots — public, no auth (02 §6, §13). The active City Pulse
 * hotspots with their member issue ids and `generated_at`. Member ids exclude
 * issues that are now REJECTED (hidden publicly); SQL filters them.
 */
import { hotspotsResponseSchema } from "@/contracts/hotspots";
import { callRpc, parseDbResult, respondOk, withApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const raw = await callRpc("active_hotspots", {});
  return respondOk(parseDbResult(hotspotsResponseSchema, raw, "active_hotspots"));
});

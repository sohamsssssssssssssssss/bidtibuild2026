/**
 * City Pulse (02 §6.8):
 *   GET  /api/hotspots             → active_hotspots()
 *   POST /api/hotspots/regenerate  → regenerate_city_pulse(p_config)
 *   POST /api/reports              → regenerate_city_pulse(p_config) in `after()`, new issues only
 */
import { CITY_PULSE_CONFIG } from "@/config/civic";
import { regenerateHotspotsResponseSchema, type RegenerateHotspotsResponse } from "@/contracts/hotspots";
import { callRpc } from "./db";
import { parseDbResult } from "./parse";

/**
 * Runs `regenerate_city_pulse` with CITY_PULSE_CONFIG (every number comes from
 * p_config) and validates the new active set. SQL takes an advisory lock, so
 * concurrent runs queue instead of duplicating hotspots.
 */
export async function regenerateCityPulse(): Promise<RegenerateHotspotsResponse> {
  const raw = await callRpc("regenerate_city_pulse", { p_config: CITY_PULSE_CONFIG });
  return parseDbResult(regenerateHotspotsResponseSchema, raw, "regenerate_city_pulse");
}

/**
 * The `after()` task of POST /api/reports: regenerates City Pulse once the
 * response has been sent. Never throws — a failure is only logged, so it can't
 * affect the report that was already created (02 §6.8).
 */
export async function regenerateCityPulseAfterReport(issueId: string): Promise<void> {
  try {
    const { hotspots } = await regenerateCityPulse();
    console.info(`[city-pulse] regenerated after new issue ${issueId}: ${hotspots.length} active hotspot(s)`);
  } catch (err) {
    console.error(`[city-pulse] regeneration after new issue ${issueId} failed:`, err);
  }
}

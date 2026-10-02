/**
 * POST /api/hotspots/regenerate — authority only (02 §6.8, §13). No body.
 * Runs `regenerate_city_pulse(CITY_PULSE_CONFIG)` and returns the new active
 * set so the UI can redraw without refetching.
 */
import { regenerateCityPulse, requireAuthority, respondOk, withApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withApi(async (req) => {
  await requireAuthority(req);
  return respondOk(await regenerateCityPulse());
});

/**
 * GET /api/my-reports — the caller's reports, newest first, each with its
 * current issue (follows merges, 02 §3.7). Anonymous citizens are users (02 §7.1).
 */
import { callRpc, myReportsRowSchema, parseDbResult, requireUser, respondOk, toMyReports, withApi } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req) => {
  const { user } = await requireUser(req);
  const raw = await callRpc("my_reports", { p_user_id: user.id });
  return respondOk(toMyReports(parseDbResult(myReportsRowSchema, raw, "my_reports")));
});

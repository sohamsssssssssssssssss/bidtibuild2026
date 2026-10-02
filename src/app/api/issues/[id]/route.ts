/**
 * GET /api/issues/:id — public, sanitised detail (02 §7.4, §10.3, §13).
 * The viewer (if signed in) is passed so a REJECTED issue stays visible to its
 * reporters and authorities only, mirroring the issues RLS policy (04 §4).
 */
import { issueDetailParamsSchema } from "@/contracts/issues";
import {
  ApiRouteError,
  callRpc,
  getCaller,
  issueDetailRowSchema,
  parseDbResult,
  parseParams,
  respondOk,
  toIssueDetail,
  withApi,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await parseParams(ctx, issueDetailParamsSchema);
  const caller = await getCaller(req);
  const raw = await callRpc("issue_detail", { p_issue_id: id, p_viewer_id: caller?.user.id ?? null });
  if (raw === null) throw new ApiRouteError("NOT_FOUND", "Issue not found.");
  return respondOk(toIssueDetail(parseDbResult(issueDetailRowSchema, raw, "issue_detail")));
});

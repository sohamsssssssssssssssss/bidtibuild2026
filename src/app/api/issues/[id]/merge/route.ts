/**
 * POST /api/issues/:id/merge — authority only (02 §3.7, §4, §13). :id is the
 * SOURCE. In one transaction SQL moves every source report to the target,
 * repoints earlier merges (no chains), marks the source MERGED and logs
 * MERGED_INTO / MERGED_FROM. Never automatic (06 rule 8).
 */
import { mergeIssueBodySchema, mergeIssueParamsSchema, mergeIssueResponseSchema } from "@/contracts/issues";
import {
  ApiRouteError,
  callRpc,
  MERGE_ISSUE_ERRORS,
  MERGE_SELF_MESSAGE,
  parseBody,
  parseDbResult,
  parseParams,
  requireAuthority,
  respondOk,
  withApi,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withApi(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireAuthority(req);
  const { id } = await parseParams(ctx, mergeIssueParamsSchema);
  const body = await parseBody(req, mergeIssueBodySchema);
  if (body.target_issue_id.toLowerCase() === id.toLowerCase()) {
    throw new ApiRouteError("VALIDATION_FAILED", MERGE_SELF_MESSAGE);
  }

  const raw = await callRpc(
    "merge_issue",
    { p_actor_id: user.id, p_source_id: id, p_target_id: body.target_issue_id, p_note: body.note ?? null },
    { errors: MERGE_ISSUE_ERRORS },
  );

  const data = parseDbResult(mergeIssueResponseSchema, raw, "merge_issue");
  return respondOk(data);
});

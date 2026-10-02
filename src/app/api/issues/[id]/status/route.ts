/**
 * PATCH /api/issues/:id/status — authority only while reopen is off (02 §4, §13).
 * Handles ASSIGNED → IN_PROGRESS and REPORTED/ASSIGNED → REJECTED (reason
 * required). REOPENED answers NOT_IMPLEMENTED until FEATURES.reopen ships;
 * whether a transition is allowed is decided in SQL (→ INVALID_TRANSITION).
 */
import { FEATURES } from "@/config/civic";
import {
  transitionIssueBodySchema,
  transitionIssueParamsSchema,
  transitionIssueResponseSchema,
} from "@/contracts/issues";
import {
  ApiRouteError,
  callRpc,
  parseBody,
  parseDbResult,
  parseParams,
  REOPEN_NOT_ENABLED_MESSAGE,
  requireAuthority,
  respondOk,
  TRANSITION_ISSUE_ERRORS,
  withApi,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const PATCH = withApi(async (req, ctx: { params: Promise<{ id: string }> }) => {
  // TODO(stretch: reopen): a citizen with a report on the issue may reopen (02 §4), so this check moves below.
  const { user } = await requireAuthority(req);
  const { id } = await parseParams(ctx, transitionIssueParamsSchema);
  const body = await parseBody(req, transitionIssueBodySchema);

  if (body.to_status === "REOPENED" && !FEATURES.reopen) {
    throw new ApiRouteError("NOT_IMPLEMENTED", REOPEN_NOT_ENABLED_MESSAGE);
  }

  const raw = await callRpc(
    "transition_issue",
    { p_actor_id: user.id, p_issue_id: id, p_to_status: body.to_status, p_note: body.note ?? null },
    { errors: TRANSITION_ISSUE_ERRORS },
  );
  return respondOk(parseDbResult(transitionIssueResponseSchema, raw, "transition_issue"));
});

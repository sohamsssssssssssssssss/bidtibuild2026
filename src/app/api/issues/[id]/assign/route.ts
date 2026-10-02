/**
 * POST /api/issues/:id/assign — authority only (02 §4, §8, §13). Assigns
 * (REPORTED → ASSIGNED) or reassigns to a different department; SQL sets
 * assigned_at and sla_due_at from the department's sla_hours.
 */
import { assignIssueBodySchema, assignIssueParamsSchema, assignIssueResponseSchema } from "@/contracts/issues";
import {
  ASSIGN_ISSUE_ERRORS,
  callRpc,
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
  const { id } = await parseParams(ctx, assignIssueParamsSchema);
  const body = await parseBody(req, assignIssueBodySchema);

  const raw = await callRpc(
    "assign_issue",
    { p_actor_id: user.id, p_issue_id: id, p_department_id: body.department_id },
    { errors: ASSIGN_ISSUE_ERRORS },
  );
  return respondOk(parseDbResult(assignIssueResponseSchema, raw, "assign_issue"));
});

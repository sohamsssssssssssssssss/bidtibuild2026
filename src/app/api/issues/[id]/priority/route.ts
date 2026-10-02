/**
 * PATCH /api/issues/:id/priority — authority only (02 §5.1, §13). Sets the
 * final priority and/or the authority severity; unchanged values write no
 * event (set_priority is idempotent per field).
 */
import { setPriorityBodySchema, setPriorityParamsSchema, setPriorityResponseSchema } from "@/contracts/issues";
import {
  callRpc,
  parseBody,
  parseDbResult,
  parseParams,
  requireAuthority,
  respondOk,
  SET_PRIORITY_ERRORS,
  withApi,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const PATCH = withApi(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireAuthority(req);
  const { id } = await parseParams(ctx, setPriorityParamsSchema);
  const body = await parseBody(req, setPriorityBodySchema);

  const raw = await callRpc(
    "set_priority",
    {
      p_actor_id: user.id,
      p_issue_id: id,
      p_final_priority: body.final_priority ?? null,
      p_authority_severity: body.authority_severity ?? null,
    },
    { errors: SET_PRIORITY_ERRORS },
  );
  return respondOk(parseDbResult(setPriorityResponseSchema, raw, "set_priority"));
});

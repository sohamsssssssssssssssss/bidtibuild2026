/**
 * POST /api/issues/:id/resolution — authority only (02 §4, §10.2, §13).
 * IN_PROGRESS → RESOLVED with a resolution_evidence row in one transaction.
 * The photo must be under the caller's uid (checked here, re-checked in SQL
 * together with its existence in the resolution-photos bucket).
 */
import { resolveIssueParamsSchema, resolveIssueBodySchema, resolveIssueResponseSchema } from "@/contracts/issues";
import { imagePathBelongsTo } from "@/contracts/primitives";
import {
  ApiRouteError,
  callRpc,
  parseBody,
  parseDbResult,
  parseParams,
  RESOLUTION_PHOTO_FORBIDDEN_MESSAGE,
  RESOLVE_ISSUE_ERRORS,
  requireAuthority,
  resolveIssueRowSchema,
  respondOk,
  toResolveIssueResponse,
  withApi,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withApi(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireAuthority(req);
  const { id } = await parseParams(ctx, resolveIssueParamsSchema);
  const body = await parseBody(req, resolveIssueBodySchema);
  if (!imagePathBelongsTo(body.image_path, user.id)) {
    throw new ApiRouteError("FORBIDDEN", RESOLUTION_PHOTO_FORBIDDEN_MESSAGE);
  }

  const raw = await callRpc(
    "resolve_issue",
    { p_actor_id: user.id, p_issue_id: id, p_image_path: body.image_path, p_note: body.note ?? null },
    { errors: RESOLVE_ISSUE_ERRORS },
  );
  const row = parseDbResult(resolveIssueRowSchema, raw, "resolve_issue");

  const data = parseDbResult(resolveIssueResponseSchema, toResolveIssueResponse(row), "POST /api/issues/:id/resolution");
  return respondOk(data);
});

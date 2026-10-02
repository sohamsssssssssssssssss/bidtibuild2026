/**
 * POST /api/issues/:id/support — a citizen's supporting report on an existing
 * issue ("This is the same issue", 02 §3.6, §9, §10.2, §13). Same body and
 * checks as POST /api/reports. Responds 201 Created.
 * `issue_id` in the response comes from SQL: if :id was merged, the report is
 * attached to the merge target and that id is returned.
 * Privacy (06 rule 22): only issue/report ids are returned.
 */
import { supportReportBodySchema, supportReportParamsSchema, supportReportResponseSchema } from "@/contracts/reports";
import {
  assertOwnImagePath,
  callRpc,
  clientIpHash,
  parseBody,
  parseDbResult,
  parseParams,
  reportWriteRowSchema,
  requireUser,
  respondOk,
  SUPPORT_WRITE_ERRORS,
  supportWriteArgs,
  withApi,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withApi(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { user } = await requireUser(req);
  const { id } = await parseParams(ctx, supportReportParamsSchema);
  const body = await parseBody(req, supportReportBodySchema);
  assertOwnImagePath(body.image_path, user.id);

  const raw = await callRpc("add_supporting_report", supportWriteArgs(user.id, clientIpHash(req), id, body), {
    errors: SUPPORT_WRITE_ERRORS,
  });
  const row = parseDbResult(reportWriteRowSchema, raw, "add_supporting_report");

  // Supporting reports do not trigger City Pulse regeneration (02 §6.8).

  const data = parseDbResult(
    supportReportResponseSchema,
    { ...row, created_new_issue: false },
    "POST /api/issues/:id/support",
  );
  return respondOk(data, { status: 201 });
});

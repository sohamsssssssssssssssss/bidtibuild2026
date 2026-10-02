/**
 * POST /api/reports — a citizen's new issue plus its first report (02 §7.3, §9, §10.2, §13).
 * Anonymous citizens are users (02 §7.1). Responds 201 Created.
 * Privacy (06 rule 22): the response carries only issue/report ids — never the
 * reporter id or IP hash.
 */
import { after } from "next/server";
import { createReportBodySchema, createReportResponseSchema } from "@/contracts/reports";
import {
  assertOwnImagePath,
  callRpc,
  clientIpHash,
  parseBody,
  parseDbResult,
  regenerateCityPulseAfterReport,
  REPORT_WRITE_ERRORS,
  reportWriteArgs,
  reportWriteRowSchema,
  requireUser,
  respondOk,
  withApi,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withApi(async (req) => {
  const body = await parseBody(req, createReportBodySchema);
  const { user } = await requireUser(req);
  assertOwnImagePath(body.image_path, user.id);

  const raw = await callRpc("create_report", reportWriteArgs(user.id, clientIpHash(req), body), {
    errors: REPORT_WRITE_ERRORS,
  });
  const row = parseDbResult(reportWriteRowSchema, raw, "create_report");

  // A new issue changes the City Pulse input: regenerate once the response is
  // sent (02 §6.8). The task catches and logs its own errors, so it never
  // affects this response. Supporting reports and merges don't trigger it.
  after(() => regenerateCityPulseAfterReport(row.issue_id));

  const data = parseDbResult(createReportResponseSchema, { ...row, created_new_issue: true }, "POST /api/reports");
  return respondOk(data, { status: 201 });
});

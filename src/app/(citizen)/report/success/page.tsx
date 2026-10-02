import Link from "next/link";
import { uuidSchema } from "@/contracts/primitives";

export default async function ReportSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ issue?: string; report?: string }>;
}) {
  const { issue, report } = await searchParams;
  const issueId = uuidSchema.safeParse(issue);
  const reportId = uuidSchema.safeParse(report);
  const confirmed = issueId.success && reportId.success;
  return (
    <div className="page-wrap">
      <section className="state-panel success-panel">
        {!confirmed ? (
          <>
            <h1>Submission not confirmed.</h1>
            <p>Check My Reports for your saved reports.</p>
            <Link href="/my-reports">View My Reports</Link>
          </>
        ) : (
          <>
            <p className="eyebrow">Report submitted</p>
            <h1>Thanks for reporting this issue.</h1>
            <p>
              Your report has been saved. You can follow its status in My
              Reports.
            </p>
            <p>Report reference: {reportId.data}</p>
            <div className="success-links">
              <Link href="/my-reports">View My Reports</Link>
              <Link href={`/issues/${issueId.data}`}>View issue detail</Link>
              <Link href="/">Back to issue map</Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

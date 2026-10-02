import Link from "next/link";
import { TESTIDS } from "@/config/testids";
import { uuidSchema } from "@/contracts/primitives";
import "@/components/report/report.css";

export default async function ReportSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    issue?: string;
    report?: string;
    supported?: string;
  }>;
}) {
  const { issue, report, supported } = await searchParams;
  const issueId = uuidSchema.safeParse(issue);
  const reportId = uuidSchema.safeParse(report);
  const confirmed = issueId.success && reportId.success;
  const supporting = supported === "1";
  return (
    <div className="page-wrap">
      <section className="state-panel success-panel">
        {!confirmed ? (
          <>
            <h1>Submission not confirmed.</h1>
            <p>
              We couldn&apos;t confirm this submission. Check My Reports to see
              whether your report was saved.
            </p>
            <div className="success-links">
              <Link href="/my-reports">View My Reports</Link>
              <Link href="/">Issue map</Link>
            </div>
          </>
        ) : (
          <div data-testid={TESTIDS.submissionSuccess}>
            <p className="eyebrow">Report submitted</p>
            <h1>Thanks for reporting this issue.</h1>
            {supporting && (
              <p className="success-note">Added to an existing issue.</p>
            )}
            <p>
              {supporting
                ? "Your report was added to an issue that was already reported nearby. You can follow its status in My Reports."
                : "Your report has been saved as a new issue. You can follow its status in My Reports."}
            </p>
            <p>Report reference: {reportId.data}</p>
            <div className="success-links">
              <Link href="/my-reports">View My Reports</Link>
              <Link href={`/issues/${issueId.data}`}>View issue detail</Link>
              <Link href="/">Issue map</Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { uuidSchema } from "@/contracts/primitives";

export default async function ReportSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ issue?: string }>;
}) {
  const { issue } = await searchParams;
  const issueId = uuidSchema.safeParse(issue);
  return (
    <div className="page-wrap">
      <section className="state-panel success-panel">
        <p className="eyebrow">Report submitted</p>
        <h1>Thanks for reporting this issue.</h1>
        <p>
          Your report has been saved. You can follow its status in My Reports.
        </p>
        <div className="success-links">
          <Link href="/my-reports">View My Reports</Link>
          {issueId.success && (
            <Link href={`/issues/${issueId.data}`}>View issue detail</Link>
          )}
          <Link href="/">Back to issue map</Link>
        </div>
      </section>
    </div>
  );
}

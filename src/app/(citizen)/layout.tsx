import Link from "next/link";
import { CitizenSession } from "@/components/auth/CitizenSession";

export default function CitizenLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link href="/" className="brand" aria-label="CivicPulse AI home">
          <span className="brand-mark" aria-hidden="true">
            ◉
          </span>
          <span>
            CivicPulse <strong>AI</strong>
          </span>
        </Link>
        <nav aria-label="Citizen navigation" className="site-nav">
          <Link href="/" aria-current="page">
            Issue map
          </Link>
          <Link href="/my-reports">My Reports</Link>
          <Link href="/authority">Authority</Link>
        </nav>
      </header>
      <CitizenSession />
      <main>{children}</main>
      <footer className="site-footer">CivicPulse AI · Bid2Build 2026</footer>
    </div>
  );
}

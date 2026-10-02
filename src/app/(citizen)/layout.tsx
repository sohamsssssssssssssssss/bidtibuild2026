import Link from "next/link";
import { CitizenSession } from "@/components/auth/CitizenSession";

export const dynamic = "force-dynamic";

export default function CitizenLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="site-shell citizen-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="CivicPulse AI home">
          <span className="brand-mark">CP</span>
          <span>
            CivicPulse <strong>AI</strong>
          </span>
        </Link>
        <nav aria-label="Citizen navigation">
          <Link href="/">Issue map</Link>
          <Link href="/report">Report issue</Link>
          <Link href="/my-reports">My Reports</Link>
          <Link href="/authority">Authority</Link>
        </nav>
      </header>
      <CitizenSession />
      <main>{children}</main>
      <footer className="site-footer">
        Civic issues, visible to everyone.
      </footer>
    </div>
  );
}

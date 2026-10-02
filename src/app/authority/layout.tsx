import Link from "next/link";
import { AuthorityNavigation } from "@/components/auth/AuthorityNavigation";
import "./authority.css";

export const dynamic = "force-dynamic";

export default function AuthorityLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="site-shell authority-shell">
      <header className="topbar">
        <Link className="brand" href="/authority">
          <span className="brand-mark">CP</span>
          <span>
            CivicPulse <strong>AI</strong>
          </span>
        </Link>
        <AuthorityNavigation />
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        Authority workspace · Recommendations inform; staff decide.
      </footer>
    </div>
  );
}

import Link from "next/link";

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
        <nav aria-label="Authority navigation">
          <Link href="/authority">Workspace</Link>
          <Link href="/">Citizen map</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        Authority workspace · Phase 0 read only
      </footer>
    </div>
  );
}

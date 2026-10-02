import Link from "next/link";

export default function AuthorityLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="site-shell authority-shell">
      <header className="site-header">
        <Link
          href="/authority"
          className="brand"
          aria-label="CivicPulse AI authority home"
        >
          <span className="brand-mark" aria-hidden="true">
            ◉
          </span>
          <span>
            CivicPulse <strong>AI</strong>
          </span>
          <span className="brand-divider" />
          <span className="authority-label">Authority</span>
        </Link>
        <nav aria-label="Authority navigation" className="site-nav">
          <Link href="/authority" aria-current="page">
            Map
          </Link>
          <Link href="/">Citizen view</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        Authority shell · Workflow starts in Phase 2
      </footer>
    </div>
  );
}

import Link from "next/link";
import "./entry.css";

/** Shell for the signed-out entry screens (landing, citizen entry). */
export function EntryShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="site-shell entry-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="CivicPulse AI home">
          <span className="brand-mark">CP</span>
          <span>
            CivicPulse <strong>AI</strong>
          </span>
        </Link>
        <nav aria-label="Entry navigation">
          <Link href="/">Issue map</Link>
          <Link href="/authority/login">Authority</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        Many citizen observations, one shared picture, decisions by the city.
      </footer>
    </div>
  );
}

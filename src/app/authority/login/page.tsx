import Link from "next/link";
import { AuthorityLoginForm } from "@/components/auth/AuthoritySession";

export default function AuthorityLoginPage() {
  return (
    <div className="page-wrap authority-login">
      <div className="page-heading">
        <p className="eyebrow">Admin · Municipal authority</p>
        <h1>Turn citizen reports into decisions.</h1>
        <p>
          Review grouped reports, see what CivicPulse recommends, then set
          priority, assign a department and move issues to resolution.
        </p>
        <p>
          Not city staff? <Link href="/login">Continue as a citizen</Link> ·{" "}
          <Link href="/">Citizen issue map</Link>
        </p>
      </div>
      <AuthorityLoginForm />
    </div>
  );
}

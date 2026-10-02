import { AuthorityLoginForm } from "@/components/auth/AuthoritySession";

export default function AuthorityLoginPage() {
  return (
    <div className="page-wrap authority-login">
      <div className="page-heading">
        <p className="eyebrow">Authority workspace</p>
        <h1>Turn citizen reports into decisions.</h1>
        <p>
          Review grouped reports, see what CivicPulse recommends, then set
          priority, assign a department and move issues to resolution.
        </p>
      </div>
      <AuthorityLoginForm />
    </div>
  );
}

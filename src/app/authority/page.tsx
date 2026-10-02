import { MapPanel } from "@/components/map/MapPanel";
import { AuthoritySession } from "@/components/auth/AuthoritySession";

export default function AuthorityPage() {
  return (
    <div className="page-body">
      <div className="page-heading">
        <div>
          <p className="eyebrow">AUTHORITY VIEW</p>
          <h1>Infrastructure map</h1>
          <p>
            The authority workspace is being prepared. Review and assignment
            arrive in Phase 2.
          </p>
        </div>
        <span className="phase-tag">Phase 0 foundation</span>
      </div>
      <AuthoritySession>
        <MapPanel />
      </AuthoritySession>
    </div>
  );
}

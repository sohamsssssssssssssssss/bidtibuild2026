import { AuthoritySession } from "@/components/auth/AuthoritySession";
import { MapPanel } from "@/components/map/MapPanel";

export default function AuthorityPage() {
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <p className="eyebrow">Authority workspace</p>
        <h1>City issue overview.</h1>
        <p>Sign in to view the Phase 0 issue map.</p>
      </div>
      <AuthoritySession>
        <MapPanel />
      </AuthoritySession>
    </div>
  );
}

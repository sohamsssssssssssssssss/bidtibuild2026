import { TESTIDS } from "@/config/testids";
import { MapPanel } from "@/components/map/MapPanel";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <p className="eyebrow">Citizen map</p>
        <h1>See what needs attention.</h1>
        <p>Explore reported infrastructure issues across the city.</p>
        <Link
          className="primary-link"
          href="/report"
          data-testid={TESTIDS.reportOpen}
        >
          Report an issue
        </Link>
      </div>
      <MapPanel />
    </div>
  );
}

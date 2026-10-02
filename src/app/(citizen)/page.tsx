import { MapPanel } from "@/components/map/MapPanel";

export default function CitizenMapPage() {
  return (
    <div className="page-body">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CITIZEN MAP</p>
          <h1>Issues across the city</h1>
          <p>
            Explore public infrastructure issues by location, category and
            status.
          </p>
        </div>
        <span className="phase-tag">Phase 0 foundation</span>
      </div>
      <MapPanel />
    </div>
  );
}

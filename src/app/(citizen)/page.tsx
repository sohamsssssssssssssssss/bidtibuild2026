import { MapPanel } from "@/components/map/MapPanel";

export default function HomePage() {
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <p className="eyebrow">Citizen map</p>
        <h1>See what needs attention.</h1>
        <p>Explore reported infrastructure issues across the city.</p>
      </div>
      <MapPanel />
    </div>
  );
}

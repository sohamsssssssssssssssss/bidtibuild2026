import { CityMap } from "./CityMap";
import { MapLegend } from "./legend";
import { getPreviewIssues } from "@/lib/map/preview-issues";

export function MapPanel() {
  return (
    <section className="map-panel" aria-label="Issue map preview">
      <div className="preview-banner">
        <strong>Illustrative preview</strong>
        <span>
          These points are examples, not live reports or demo seed data.
        </span>
      </div>
      <CityMap issues={getPreviewIssues()} />
      <MapLegend />
    </section>
  );
}

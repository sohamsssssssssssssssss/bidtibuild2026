import { CityMap } from "./CityMap";
import { MapLegend } from "./legend";

export function MapPanel() {
  return (
    <section className="map-panel" aria-label="Issue map">
      <CityMap />
      <MapLegend />
    </section>
  );
}

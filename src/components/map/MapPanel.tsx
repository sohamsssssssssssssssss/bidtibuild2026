import { CityMap } from "./CityMap";
import { Legend } from "./Legend";

export function MapPanel() {
  return (
    <section className="map-panel" aria-label="City issues map">
      <CityMap />
      <Legend />
    </section>
  );
}

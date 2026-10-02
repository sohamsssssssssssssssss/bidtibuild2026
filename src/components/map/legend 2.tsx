export const categoryIcons: Record<string, string> = {
  POTHOLE: "P",
  STREETLIGHT: "L",
  GARBAGE: "G",
  WATER_LEAK: "W",
  DRAINAGE: "D",
  WATERLOGGING: "≈",
  FOOTPATH: "F",
  PUBLIC_PROPERTY: "◆",
  OTHER: "•",
};

export const statusColours: Record<string, string> = {
  REPORTED: "#c55a32",
  ASSIGNED: "#b48627",
  IN_PROGRESS: "#276c9a",
  RESOLVED: "#278064",
};

const label = (name: string) => name.replaceAll("_", " ").toLowerCase();

export function MapLegend() {
  return (
    <div className="legend" aria-label="Map legend">
      <div>
        <h2>Issue status</h2>
        <ul className="legend-status">
          {Object.entries(statusColours).map(([status, colour]) => (
            <li key={status}>
              <span
                className="status-dot"
                style={{ backgroundColor: colour }}
              />
              {label(status)}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2>Category symbols</h2>
        <ul className="legend-categories">
          {Object.entries(categoryIcons).map(([category, icon]) => (
            <li key={category}>
              <span className="category-icon" aria-hidden="true">
                {icon}
              </span>
              {label(category)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

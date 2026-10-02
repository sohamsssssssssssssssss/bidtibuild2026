import {
  CATEGORIES,
  CATEGORY_META,
  MAP_STATUSES,
  STATUS_META,
  type Category,
} from "@/config/civic";

export const categoryIcons: Record<Category, string> = {
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

export function MapLegend() {
  return (
    <div className="legend" aria-label="Map legend">
      <div>
        <h2>Issue status</h2>
        <ul className="legend-status">
          {MAP_STATUSES.map((status) => (
            <li key={status}>
              <span
                className="status-dot"
                style={{ backgroundColor: STATUS_META[status].color }}
              />
              {STATUS_META[status].label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2>Category symbols</h2>
        <ul className="legend-categories">
          {CATEGORIES.map((category) => (
            <li key={category}>
              <span className="category-icon" aria-hidden="true">
                {categoryIcons[category]}
              </span>
              {CATEGORY_META[category].label}
            </li>
          ))}
        </ul>
        <p className="demo-legend">
          <span className="status-dot demo-dot" /> Demo data (seeded issue)
        </p>
      </div>
    </div>
  );
}

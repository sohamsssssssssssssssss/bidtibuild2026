import {
  CATEGORIES,
  CATEGORY_META,
  MAP_STATUSES,
  STATUS_META,
} from "@/config/civic";
import { CATEGORY_ICONS } from "./categoryIcons";

export function Legend() {
  return (
    <aside className="legend" aria-label="Map legend">
      <div>
        <h2>Status</h2>
        <ul>
          {MAP_STATUSES.map((status) => (
            <li key={status}>
              <span
                className="legend-dot"
                style={{ backgroundColor: STATUS_META[status].color }}
              />
              {STATUS_META[status].label}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2>Category</h2>
        <ul className="category-legend">
          {CATEGORIES.map((category) => (
            <li key={category}>
              <span className="legend-icon">{CATEGORY_ICONS[category]}</span>
              {CATEGORY_META[category].label}
            </li>
          ))}
        </ul>
      </div>
      <p className="legend-note">
        <span className="demo-tag">Demo data</span> marks seeded examples.
      </p>
    </aside>
  );
}

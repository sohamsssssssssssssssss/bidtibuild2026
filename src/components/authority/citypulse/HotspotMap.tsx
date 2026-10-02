"use client";

import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, Polygon } from "geojson";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";
import {
  CATEGORY_META,
  LEVEL_META,
  LEVELS,
  MAP_DEFAULT_VIEW,
  MAP_STYLE_URL,
} from "@/config/civic";
import type { Hotspot } from "@/contracts/hotspots";

const SOURCE = "hotspots";
const FILL = "hotspot-fill";
const OUTLINE = "hotspot-outline";
const SELECTED = "hotspot-selected";

function features(rows: Hotspot[]): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      geometry: row.geometry as Polygon,
      properties: { id: row.id, severity: row.severity },
    })),
  };
}

function severityColor(): ExpressionSpecification {
  return [
    "match",
    ["get", "severity"],
    ...LEVELS.flatMap((level) => [level, LEVEL_META[level].color]),
    LEVEL_META.LOW.color,
  ] as unknown as ExpressionSpecification;
}

function selectedFilter(id: string | null): ExpressionSpecification {
  return ["==", ["get", "id"], id ?? ""];
}

function bounds(rows: Hotspot[]): [number, number, number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const row of rows)
    for (const ring of row.geometry.coordinates)
      for (const [lng, lat] of ring) {
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
  return Number.isFinite(minLng) ? [minLng, minLat, maxLng, maxLat] : null;
}

/**
 * Hotspot polygons on a MapLibre map. Fill colour follows LEVEL_META by the
 * recommended severity; clicking a polygon selects that hotspot.
 */
export function HotspotMap({
  hotspots,
  selectedId,
  onSelect,
}: {
  hotspots: Hotspot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({ hotspots, selectedId, onSelect });
  const [error, setError] = useState("");

  useEffect(() => {
    latest.current = { hotspots, selectedId, onSelect };
  });

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let map: MapLibreMap | undefined;
    let resizeObserver: ResizeObserver | undefined;

    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (disposed || !container.current) return;
      maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      map = new maplibre.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        center: [MAP_DEFAULT_VIEW.center.lng, MAP_DEFAULT_VIEW.center.lat],
        zoom: MAP_DEFAULT_VIEW.zoom,
        attributionControl: false,
      });
      mapRef.current = map;
      resizeObserver = new ResizeObserver(() => map?.resize());
      resizeObserver.observe(container.current);
      map.addControl(
        new maplibre.NavigationControl({ showCompass: false }),
        "top-right",
      );
      map.addControl(
        new maplibre.AttributionControl({ compact: true }),
        "bottom-right",
      );

      map.on("load", () => {
        if (!map || disposed) return;
        const { hotspots: rows, selectedId: selected } = latest.current;
        map.addSource(SOURCE, { type: "geojson", data: features(rows) });
        map.addLayer({
          id: FILL,
          type: "fill",
          source: SOURCE,
          paint: { "fill-color": severityColor(), "fill-opacity": 0.28 },
        });
        map.addLayer({
          id: OUTLINE,
          type: "line",
          source: SOURCE,
          paint: { "line-color": severityColor(), "line-width": 2 },
        });
        map.addLayer({
          id: SELECTED,
          type: "line",
          source: SOURCE,
          filter: selectedFilter(selected),
          paint: { "line-color": "#142d3b", "line-width": 4 },
        });
        ready.current = true;
        const box = bounds(rows);
        if (box) map.fitBounds(box, { padding: 60, maxZoom: 15, duration: 0 });
      });
      map.on("click", FILL, (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") latest.current.onSelect(id);
      });
      map.on("mouseenter", FILL, () => {
        if (map) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", FILL, () => {
        if (map) map.getCanvas().style.cursor = "";
      });
    })().catch((cause: unknown) => {
      if (!disposed)
        setError(cause instanceof Error ? cause.message : "Map unavailable.");
    });

    return () => {
      disposed = true;
      ready.current = false;
      mapRef.current = null;
      resizeObserver?.disconnect();
      map?.remove();
    };
  }, []);

  // New data: redraw and frame it. Guarded: the source exists only after `load`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(features(hotspots));
    const box = bounds(hotspots);
    if (box) map.fitBounds(box, { padding: 60, maxZoom: 15 });
  }, [hotspots]);

  // Selection: highlight and bring the polygon into view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !map.getLayer(SELECTED)) return;
    map.setFilter(SELECTED, selectedFilter(selectedId));
    const row = latest.current.hotspots.find((h) => h.id === selectedId);
    const box = row ? bounds([row]) : null;
    if (box) map.fitBounds(box, { padding: 80, maxZoom: 15.5 });
  }, [selectedId]);

  const selected = hotspots.find((h) => h.id === selectedId);

  return (
    <div className="cp-map">
      <div
        className="cp-map-canvas"
        ref={container}
        role="region"
        aria-label={
          selected
            ? `Map of City Pulse hotspots. Selected: ${CATEGORY_META[selected.category].label}, ${LEVEL_META[selected.severity].label}`
            : "Map of City Pulse hotspots"
        }
      />
      <ul className="cp-legend" aria-label="Severity legend">
        {LEVELS.map((level) => (
          <li key={level}>
            <span
              className="cp-swatch"
              style={{ background: LEVEL_META[level].color }}
              aria-hidden="true"
            />
            {LEVEL_META[level].label}
          </li>
        ))}
      </ul>
      {error && (
        <div className="map-notice error" role="alert">
          Map unavailable: {error}. The hotspot list still works.
        </div>
      )}
    </div>
  );
}

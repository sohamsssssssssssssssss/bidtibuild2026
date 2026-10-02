"use client";

import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
} from "maplibre-gl";
import { apiEnvelopeSchema } from "@/contracts/envelope";
import {
  issueDetailResponseSchema,
  issuesResponseSchema,
  type IssueMarker,
} from "@/contracts/issues";
import { formatBbox } from "@/contracts/primitives";
import {
  CATEGORY_META,
  MAP_DEFAULT_VIEW,
  MAP_STYLE_URL,
  MAP_STATUSES,
  STATUS_META,
} from "@/config/civic";
import { CATEGORY_ICONS } from "./categoryIcons";

const issuesEnvelope = apiEnvelopeSchema(issuesResponseSchema);
const detailEnvelope = apiEnvelopeSchema(issueDetailResponseSchema);

function features(rows: IssueMarker[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      id: row.id,
      geometry: { type: "Point", coordinates: [row.lng, row.lat] },
      properties: {
        id: row.id,
        category: row.category,
        status: row.status,
        is_seed: row.is_seed,
      },
    })),
  };
}

function statusColors(): unknown[] {
  return [
    "match",
    ["get", "status"],
    ...MAP_STATUSES.flatMap((status) => [status, STATUS_META[status].color]),
    STATUS_META.REPORTED.color,
  ];
}

function categoryLetters(): unknown[] {
  return [
    "match",
    ["get", "category"],
    ...Object.entries(CATEGORY_ICONS).flatMap(([category, icon]) => [
      category,
      icon,
    ]),
    CATEGORY_ICONS.OTHER,
  ];
}

function text(
  container: HTMLElement,
  tag: keyof HTMLElementTagNameMap,
  value: string,
  className?: string,
) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  container.append(element);
  return element;
}

export function CityMap() {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [count, setCount] = useState(0);
  const [seedCount, setSeedCount] = useState(0);
  const retry = useRef<() => void>(() => {});

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let map: MapLibreMap | undefined;
    let controller: AbortController | undefined;
    let lastBbox = "";
    let hasLoaded = false;
    let popup: import("maplibre-gl").Popup | undefined;
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

      async function load(force = false) {
        if (!map) return;
        const bounds = map.getBounds();
        const bbox = formatBbox({
          minLng: bounds.getWest(),
          minLat: bounds.getSouth(),
          maxLng: bounds.getEast(),
          maxLat: bounds.getNorth(),
        });
        if (!force && bbox === lastBbox) return;
        lastBbox = bbox;
        controller?.abort();
        const requestController = new AbortController();
        controller = requestController;
        if (!hasLoaded) setState("loading");
        try {
          const response = await fetch(
            `/api/issues?bbox=${encodeURIComponent(bbox)}`,
            { signal: requestController.signal, cache: "no-store" },
          );
          const parsed = issuesEnvelope.parse(await response.json());
          if (!response.ok || parsed.error)
            throw new Error(parsed.error?.message ?? "Could not load issues.");
          const rows = parsed.data;
          (map?.getSource("issues") as GeoJSONSource | undefined)?.setData(
            features(rows),
          );
          hasLoaded = true;
          setCount(rows.length);
          setSeedCount(rows.filter((row) => row.is_seed).length);
          setState(rows.length ? "ready" : "empty");
          setMessage("");
        } catch (cause) {
          if (requestController.signal.aborted || disposed) return;
          setMessage(
            cause instanceof Error ? cause.message : "Could not load issues.",
          );
          setState("error");
        }
      }
      retry.current = () => {
        void load(true);
      };

      map.on("load", () => {
        if (!map) return;
        map.addSource("issues", {
          type: "geojson",
          data: features([]),
          cluster: true,
          clusterRadius: 48,
          clusterMaxZoom: 14,
        });
        map.addLayer({
          id: "issue-clusters",
          type: "circle",
          source: "issues",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#123b56",
            "circle-radius": [
              "step",
              ["get", "point_count"],
              20,
              10,
              26,
              30,
              32,
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "issues",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 13,
            "text-font": ["Noto Sans Regular"],
          },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: "issue-markers",
          type: "circle",
          source: "issues",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color":
              statusColors() as import("maplibre-gl").ExpressionSpecification,
            "circle-radius": 14,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "category-icons",
          type: "symbol",
          source: "issues",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field":
              categoryLetters() as import("maplibre-gl").ExpressionSpecification,
            "text-size": 9,
            "text-font": ["Noto Sans Regular"],
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff" },
        });
        void load();
      });
      map.on("moveend", () => {
        void load();
      });
      map.on("click", "issue-clusters", (event) => {
        const feature = map?.queryRenderedFeatures(event.point, {
          layers: ["issue-clusters"],
        })[0];
        const clusterId = feature?.properties?.cluster_id;
        const source = map?.getSource("issues") as GeoJSONSource | undefined;
        if (!feature || clusterId == null || !source || !map) return;
        void source.getClusterExpansionZoom(clusterId).then((zoom) => {
          if (map)
            map.easeTo({
              center: (feature.geometry as Point).coordinates as [
                number,
                number,
              ],
              zoom,
            });
        });
      });
      async function openIssue(event: MapMouseEvent) {
        const feature = map?.queryRenderedFeatures(event.point, {
          layers: ["issue-markers"],
        })[0];
        const id = feature?.properties?.id;
        if (!map || !feature || typeof id !== "string") return;
        popup?.remove();
        const card = document.createElement("div");
        card.className = "issue-popup";
        text(card, "p", "Loading issue…");
        popup = new maplibre.Popup({ offset: 18, maxWidth: "310px" })
          .setLngLat(
            (feature.geometry as Point).coordinates as [number, number],
          )
          .setDOMContent(card)
          .addTo(map);
        try {
          const response = await fetch(
            `/api/issues/${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          const parsed = detailEnvelope.parse(await response.json());
          if (!response.ok || parsed.error)
            throw new Error(parsed.error?.message ?? "Issue unavailable.");
          const issue = parsed.data;
          card.replaceChildren();
          if (issue.is_seed) text(card, "span", "Demo data", "demo-tag");
          text(card, "h3", CATEGORY_META[issue.category].label);
          text(
            card,
            "p",
            `${STATUS_META[issue.status].label} · ${issue.report_count} ${issue.report_count === 1 ? "report" : "reports"}`,
          );
          const photo = issue.is_seed
            ? null
            : issue.photos.find((item) => item.image_url)?.image_url;
          if (photo) {
            const image = document.createElement("img");
            image.src = photo;
            image.alt = `Report photo for ${CATEGORY_META[issue.category].label}`;
            card.append(image);
          } else text(card, "p", "Photo unavailable", "photo-fallback");
          const description = issue.photos[0]?.description;
          if (description) text(card, "p", description);
          const detail = document.createElement("a");
          detail.href = `/issues/${encodeURIComponent(issue.id)}`;
          detail.textContent = "View issue detail";
          card.append(detail);
        } catch (cause) {
          card.replaceChildren();
          text(
            card,
            "p",
            cause instanceof Error ? cause.message : "Issue unavailable.",
            "form-error",
          );
        }
      }
      map.on("click", "issue-markers", (event) => {
        void openIssue(event);
      });
      map.on("mouseenter", "issue-markers", () => {
        if (map) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "issue-markers", () => {
        if (map) map.getCanvas().style.cursor = "";
      });
    })().catch((cause) => {
      if (!disposed) {
        setMessage(cause instanceof Error ? cause.message : "Map unavailable.");
        setState("error");
      }
    });
    return () => {
      disposed = true;
      controller?.abort();
      popup?.remove();
      resizeObserver?.disconnect();
      map?.remove();
    };
  }, []);

  return (
    <div className="map-column">
      <div className="map-toolbar">
        <span>
          {state === "loading"
            ? "Loading issues…"
            : state === "error"
              ? "Issues unavailable"
              : `${count} ${count === 1 ? "issue" : "issues"} in view`}
        </span>
        {seedCount > 0 && (
          <span className="demo-tag">{seedCount} demo data</span>
        )}
      </div>
      <div
        className="map-canvas"
        ref={container}
        aria-label="Interactive map of civic issues"
      />
      {state === "empty" && (
        <div className="map-notice" role="status">
          No issues in this area. Move the map to explore.
        </div>
      )}
      {state === "error" && (
        <div className="map-notice error" role="alert">
          {message}
          <button onClick={() => retry.current()}>Retry</button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource } from "maplibre-gl";
import {
  CATEGORY_META,
  MAP_DEFAULT_VIEW,
  MAP_STYLE_URL,
  STATUS_META,
} from "@/config/civic";
import { apiEnvelopeSchema } from "@/contracts/envelope";
import {
  issueDetailResponseSchema,
  issuesResponseSchema,
} from "@/contracts/issues";
import { formatBbox } from "@/contracts/primitives";
import { categoryIcons } from "./legend";

const emptyIssues = { type: "FeatureCollection" as const, features: [] };

export function CityMap() {
  const container = useRef<HTMLDivElement>(null);
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [issuesState, setIssuesState] = useState<
    "loading" | "ready" | "empty" | "error"
  >("loading");
  const [issueCount, setIssueCount] = useState(0);
  const [seedCount, setSeedCount] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let request: AbortController | undefined;
    let lastBbox: string | undefined;
    let styleTimeout: ReturnType<typeof setTimeout> | undefined;
    let cleanupMap: (() => void) | undefined;

    import("maplibre-gl")
      .then(({ Map, NavigationControl, Popup, setWorkerUrl }) => {
        if (disposed || !container.current) return;
        setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const map = new Map({
          container: container.current,
          style: MAP_STYLE_URL,
          center: [MAP_DEFAULT_VIEW.center.lng, MAP_DEFAULT_VIEW.center.lat],
          zoom: MAP_DEFAULT_VIEW.zoom,
        });
        cleanupMap = () => map.remove();
        resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(container.current);
        map.addControl(
          new NavigationControl({ showCompass: false }),
          "top-right",
        );
        styleTimeout = setTimeout(() => setMapState("error"), 10000);
        map.once("style.load", () => {
          if (disposed) return;
          clearTimeout(styleTimeout);
          map.addSource("issues", {
            type: "geojson",
            data: emptyIssues,
            cluster: true,
            clusterRadius: 48,
            clusterProperties: {
              seed_count: ["+", ["case", ["get", "is_seed"], 1, 0]],
            },
          });
          map.addLayer({
            id: "issue-clusters",
            type: "circle",
            source: "issues",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#173e50",
              "circle-radius": [
                "step",
                ["get", "point_count"],
                21,
                10,
                27,
                50,
                33,
              ],
              "circle-stroke-color": [
                "case",
                [">", ["get", "seed_count"], 0],
                "#facc15",
                "#fff",
              ],
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
              "text-font": ["Noto Sans Bold"],
              "text-size": 13,
            },
            paint: { "text-color": "#fff" },
          });
          map.addLayer({
            id: "issue-points",
            type: "circle",
            source: "issues",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": [
                "match",
                ["get", "status"],
                ...Object.entries(STATUS_META).flatMap(([status, meta]) => [
                  status,
                  meta.color,
                ]),
                "#566573",
              ] as unknown as ExpressionSpecification,
              "circle-radius": 16,
              "circle-stroke-color": [
                "case",
                ["get", "is_seed"],
                "#facc15",
                "#fff",
              ],
              "circle-stroke-width": ["case", ["get", "is_seed"], 4, 2.5],
            },
          });
          map.addLayer({
            id: "issue-icons",
            type: "symbol",
            source: "issues",
            filter: ["!", ["has", "point_count"]],
            layout: {
              "text-field": [
                "match",
                ["get", "category"],
                ...Object.entries(categoryIcons).flatMap(([category, icon]) => [
                  category,
                  icon,
                ]),
                "?",
              ] as unknown as ExpressionSpecification,
              "text-font": ["Noto Sans Bold"],
              "text-size": 14,
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#fff" },
          });
          setMapState("ready");

          const loadIssues = async () => {
            const bounds = map.getBounds();
            const bbox = formatBbox({
              minLng: Math.max(-180, bounds.getWest()),
              minLat: Math.max(-90, bounds.getSouth()),
              maxLng: Math.min(180, bounds.getEast()),
              maxLat: Math.min(90, bounds.getNorth()),
            });
            if (bbox === lastBbox) return;
            lastBbox = bbox;
            request?.abort();
            request = new AbortController();
            const signal = request.signal;
            setIssuesState("loading");
            try {
              const response = await fetch(
                `/api/issues?bbox=${encodeURIComponent(bbox)}`,
                { signal },
              );
              const parsed = apiEnvelopeSchema(issuesResponseSchema).safeParse(
                await response.json(),
              );
              if (!response.ok || !parsed.success || parsed.data.error)
                throw new Error("Issue API unavailable");
              const issues = parsed.data.data;
              map.getSource<GeoJSONSource>("issues")?.setData({
                type: "FeatureCollection",
                features: issues.map((issue) => ({
                  type: "Feature" as const,
                  geometry: {
                    type: "Point" as const,
                    coordinates: [issue.lng, issue.lat],
                  },
                  properties: issue,
                })),
              });
              setIssueCount(issues.length);
              setSeedCount(issues.filter((issue) => issue.is_seed).length);
              setIssuesState(issues.length ? "ready" : "empty");
            } catch {
              if (!signal.aborted) {
                setIssuesState("error");
              }
            }
          };
          map.on("moveend", loadIssues);
          void loadIssues();
        });
        map.on("click", "issue-clusters", async (event) => {
          const clusterId = event.features?.[0]?.properties?.cluster_id;
          const geometry = event.features?.[0]?.geometry;
          const source = map.getSource<GeoJSONSource>("issues");
          if (
            typeof clusterId !== "number" ||
            !source ||
            geometry?.type !== "Point"
          )
            return;
          map.easeTo({
            center: geometry.coordinates as [number, number],
            zoom: await source.getClusterExpansionZoom(clusterId),
          });
        });
        map.on("click", "issue-points", async (event) => {
          const feature = event.features?.[0];
          if (feature?.geometry.type !== "Point") return;
          const props = feature.properties;
          const popup = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = `${CATEGORY_META[props.category as keyof typeof CATEGORY_META]?.label ?? props.category} · ${STATUS_META[props.status as keyof typeof STATUS_META]?.label ?? props.status}`;
          popup.append(title);
          if (props.is_seed) {
            const badge = document.createElement("p");
            badge.textContent = "Demo data";
            popup.append(badge);
          }
          const details = document.createElement("p");
          details.textContent = "Loading issue details…";
          popup.append(details);
          const photo = document.createElement("p");
          if (props.is_seed) photo.textContent = "Photo unavailable";
          popup.append(photo);
          const openPopup = new Popup({ offset: 18 })
            .setLngLat(feature.geometry.coordinates as [number, number])
            .setDOMContent(popup)
            .addTo(map);
          try {
            const response = await fetch(
              `/api/issues/${encodeURIComponent(props.id)}`,
              { cache: "no-store" },
            );
            const parsed = apiEnvelopeSchema(
              issueDetailResponseSchema,
            ).safeParse(await response.json());
            if (!response.ok || !parsed.success || parsed.data.error)
              throw new Error("Issue detail unavailable");
            if (!openPopup.isOpen()) return;
            const issue = parsed.data.data;
            details.textContent = `${issue.photos[0]?.description ?? "No report description available."} · ${issue.report_count} ${issue.report_count === 1 ? "report" : "reports"}`;
            const imageUrl = issue.photos[0]?.image_url;
            if (imageUrl) {
              photo.textContent = "";
              const link = document.createElement("a");
              link.href = imageUrl;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              link.textContent = "View photo";
              photo.append(link);
            } else photo.textContent = "Photo unavailable";
          } catch {
            if (openPopup.isOpen())
              details.textContent = "Issue details unavailable.";
          }
        });
      })
      .catch(() => setMapState("error"));

    return () => {
      disposed = true;
      request?.abort();
      clearTimeout(styleTimeout);
      resizeObserver?.disconnect();
      cleanupMap?.();
    };
  }, []);

  return (
    <div className="map-wrap">
      <div
        ref={container}
        className="map-canvas"
        role="img"
        aria-label="Map of civic issues, clustered by location"
      />
      {mapState === "loading" && (
        <div className="map-message">Loading map…</div>
      )}
      {mapState === "error" && (
        <div className="map-message">
          Map tiles are unavailable. Check your connection and try again.
        </div>
      )}
      {mapState === "ready" && issuesState === "loading" && (
        <div className="map-message">Loading issues…</div>
      )}
      {mapState === "ready" && issuesState === "error" && (
        <div className="map-message" role="alert">
          Could not load issues. Move the map to retry.
        </div>
      )}
      {mapState === "ready" && issuesState === "empty" && (
        <div className="map-message">No issues in this map area.</div>
      )}
      {mapState === "ready" && issuesState === "ready" && (
        <div className="map-count" aria-live="polite">
          {issueCount} {issueCount === 1 ? "issue" : "issues"} in view
          {seedCount > 0 ? ` · ${seedCount} demo data` : ""}
        </div>
      )}
    </div>
  );
}

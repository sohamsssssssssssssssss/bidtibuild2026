"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { IssueGeoJSON } from "@/lib/map/preview-issues";
import { categoryIcons, statusColours } from "./legend";

export function CityMap({ issues }: { issues: IssueGeoJSON }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const initialIssues = useRef(issues);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let instance: MapLibreMap | undefined;
    let styleTimeout: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;

    import("maplibre-gl")
      .then(({ Map, LngLatBounds, NavigationControl, setWorkerUrl }) => {
        if (disposed || !container.current) return;
        setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        instance = new Map({
          container: container.current,
          style: "https://tiles.openfreemap.org/styles/liberty",
          center: [0, 0],
          zoom: 1,
        });
        map.current = instance;
        resizeObserver = new ResizeObserver(() => instance?.resize());
        resizeObserver.observe(container.current);
        instance.addControl(
          new NavigationControl({ showCompass: false }),
          "top-right",
        );
        styleTimeout = setTimeout(() => setState("error"), 10000);
        instance.once("style.load", () => {
          if (!instance) return;
          clearTimeout(styleTimeout);
          instance.addSource("issues", {
            type: "geojson",
            data: initialIssues.current,
            cluster: true,
            clusterRadius: 48,
          });
          instance.addLayer({
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
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 2,
            },
          });
          instance.addLayer({
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
          instance.addLayer({
            id: "issue-points",
            type: "circle",
            source: "issues",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": [
                "match",
                ["get", "status"],
                "REPORTED",
                statusColours.REPORTED,
                "ASSIGNED",
                statusColours.ASSIGNED,
                "IN_PROGRESS",
                statusColours.IN_PROGRESS,
                "RESOLVED",
                statusColours.RESOLVED,
                "#566573",
              ],
              "circle-radius": 16,
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 2.5,
            },
          });
          instance.addLayer({
            id: "issue-icons",
            type: "symbol",
            source: "issues",
            filter: ["!", ["has", "point_count"]],
            layout: {
              "text-field": [
                "match",
                ["get", "category"],
                "POTHOLE",
                categoryIcons.POTHOLE,
                "STREETLIGHT",
                categoryIcons.STREETLIGHT,
                "GARBAGE",
                categoryIcons.GARBAGE,
                "WATER_LEAK",
                categoryIcons.WATER_LEAK,
                "DRAINAGE",
                categoryIcons.DRAINAGE,
                "WATERLOGGING",
                categoryIcons.WATERLOGGING,
                "FOOTPATH",
                categoryIcons.FOOTPATH,
                "PUBLIC_PROPERTY",
                categoryIcons.PUBLIC_PROPERTY,
                "OTHER",
                categoryIcons.OTHER,
                "?",
              ],
              "text-font": ["Noto Sans Bold"],
              "text-size": 14,
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#fff" },
          });
          if (initialIssues.current.features.length) {
            const bounds = new LngLatBounds();
            initialIssues.current.features.forEach((feature) =>
              bounds.extend(feature.geometry.coordinates),
            );
            instance.fitBounds(bounds, {
              padding: 60,
              maxZoom: 13,
              duration: 0,
            });
          }
          setState("ready");
        });
        instance.on("click", "issue-clusters", async (event) => {
          if (!instance) return;
          const clusterId = event.features?.[0]?.properties?.cluster_id;
          const source = instance.getSource<GeoJSONSource>("issues");
          const geometry = event.features?.[0]?.geometry;
          if (
            typeof clusterId !== "number" ||
            !source ||
            geometry?.type !== "Point"
          )
            return;
          const zoom = await source.getClusterExpansionZoom(clusterId);
          instance.easeTo({
            center: geometry.coordinates as [number, number],
            zoom,
          });
        });
      })
      .catch(() => setState("error"));

    return () => {
      disposed = true;
      clearTimeout(styleTimeout);
      resizeObserver?.disconnect();
      instance?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const source = map.current?.getSource<GeoJSONSource>("issues");
    if (source) source.setData(issues);
  }, [issues]);

  return (
    <div className="map-wrap">
      <div
        ref={container}
        className="map-canvas"
        role="img"
        aria-label="Map of civic issues, clustered by location"
      />
      {state === "loading" && <div className="map-message">Loading map…</div>}
      {state === "error" && (
        <div className="map-message">
          Map tiles are unavailable. Check your connection and try again.
        </div>
      )}
    </div>
  );
}

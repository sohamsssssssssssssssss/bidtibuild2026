"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { MAP_DEFAULT_VIEW, MAP_STYLE_URL } from "@/config/civic";

export type Pin = { lat: number; lng: number };

export function LocationPicker({
  pin,
  onChange,
}: {
  pin: Pin | null;
  onChange: (pin: Pin) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState(
    "Tap the map to place your pin, or use your location.",
  );
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let map: MapLibreMap | undefined;
    let observer: ResizeObserver | undefined;
    void import("maplibre-gl")
      .then((maplibre) => {
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
        setReady(true);
        observer = new ResizeObserver(() => map?.resize());
        observer.observe(container.current);
        map.addControl(
          new maplibre.NavigationControl({ showCompass: false }),
          "top-right",
        );
        map.addControl(
          new maplibre.AttributionControl({ compact: true }),
          "bottom-right",
        );
        map.on("click", (event) =>
          onChangeRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng }),
        );
      })
      .catch(() =>
        setMessage("Map unavailable. Please retry when the map loads."),
      );
    return () => {
      disposed = true;
      observer?.disconnect();
      markerRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pin) return;
    void import("maplibre-gl").then(({ Marker }) => {
      if (!mapRef.current) return;
      markerRef.current?.remove();
      markerRef.current = new Marker({ draggable: true, color: "#e85c40" })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      markerRef.current.on("dragend", () => {
        const point = markerRef.current?.getLngLat();
        if (point) onChangeRef.current({ lat: point.lat, lng: point.lng });
      });
      map.flyTo({
        center: [pin.lng, pin.lat],
        zoom: Math.max(map.getZoom(), 15),
      });
    });
  }, [pin, ready]);

  function useLocation() {
    if (!navigator.geolocation) {
      setMessage("Location is unavailable. Tap the map to set your pin.");
      return;
    }
    setMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        onChangeRef.current({ lat: coords.latitude, lng: coords.longitude });
        setMessage("Location found. Drag the pin to adjust it.");
      },
      () =>
        setMessage(
          "Location permission unavailable. Tap the map to set your pin.",
        ),
      { enableHighAccuracy: true },
    );
  }

  return (
    <div className="location-picker">
      <div className="location-toolbar">
        <span>
          {pin
            ? `Pin: ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`
            : "No pin placed"}
        </span>
        <button type="button" onClick={useLocation}>
          Use my location
        </button>
      </div>
      <div
        className="location-map"
        ref={container}
        aria-label="Choose report location on map"
      />
      <p role="status">{message}</p>
    </div>
  );
}

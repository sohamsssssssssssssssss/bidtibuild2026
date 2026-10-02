"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { MAP_DEFAULT_VIEW, MAP_STYLE_URL } from "@/config/civic";
import { TESTIDS } from "@/config/testids";
import "@/components/report/report.css";

export type Pin = { lat: number; lng: number };

const DEFAULT_MESSAGE = "Tap the map to place your pin, or use your location.";
const MANUAL_HINT = "You can still tap the map to place your pin.";

function geolocationMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED)
    return `Location permission was denied. ${MANUAL_HINT}`;
  if (error.code === error.TIMEOUT)
    return `Finding your location took too long. ${MANUAL_HINT}`;
  return `Your location is unavailable right now. ${MANUAL_HINT}`;
}

export function LocationPicker({
  pin,
  onChange,
  onLocating,
}: {
  pin: Pin | null;
  onChange: (pin: Pin) => void;
  /** Receives the pending GPS lookup so submit can wait for it. */
  onLocating?: (pending: Promise<Pin | null> | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  /** Pin set by tapping or dragging on the map itself: don't re-centre for it. */
  const placedOnMapRef = useRef<Pin | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let loaded = false;
    let map: MapLibreMap | undefined;
    let observer: ResizeObserver | undefined;
    const fail = () => {
      if (disposed || loaded) return;
      setFailed(true);
    };
    const timeout = window.setTimeout(fail, 20_000);
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
        map.on("load", () => {
          loaded = true;
          window.clearTimeout(timeout);
          if (!disposed) setFailed(false);
        });
        map.on("error", fail);
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
        map.on("click", (event) => {
          const next = { lat: event.lngLat.lat, lng: event.lngLat.lng };
          placedOnMapRef.current = next;
          onChangeRef.current(next);
          setWarning(false);
          setMessage("Pin placed. Drag it to adjust.");
        });
      })
      .catch(fail);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      observer?.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pin || !ready) return;
    let cancelled = false;
    void import("maplibre-gl").then(({ Marker }) => {
      if (cancelled || mapRef.current !== map) return;
      if (!markerRef.current) {
        const marker = new Marker({ draggable: true, color: "#e85c40" })
          .setLngLat([pin.lng, pin.lat])
          .addTo(map);
        marker.on("dragend", () => {
          const point = marker.getLngLat();
          const next = { lat: point.lat, lng: point.lng };
          placedOnMapRef.current = next;
          onChangeRef.current(next);
          setWarning(false);
          setMessage("Pin moved.");
        });
        markerRef.current = marker;
      } else {
        markerRef.current.setLngLat([pin.lng, pin.lat]);
      }
      if (placedOnMapRef.current === pin) return;
      map.flyTo({
        center: [pin.lng, pin.lat],
        zoom: Math.max(map.getZoom(), 15),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pin, ready, attempt]);

  function useLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setWarning(true);
      setMessage(`This browser can't share your location. ${MANUAL_HINT}`);
      onLocating?.(null);
      return;
    }
    setLocating(true);
    setWarning(false);
    setMessage("Finding your location…");
    const pending = new Promise<Pin | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const next = { lat: coords.latitude, lng: coords.longitude };
          placedOnMapRef.current = null;
          onChangeRef.current(next);
          setMessage("Location found. Drag the pin to adjust it.");
          setLocating(false);
          resolve(next);
        },
        (error) => {
          setWarning(true);
          setMessage(geolocationMessage(error));
          setLocating(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
      );
    });
    onLocating?.(pending);
  }

  function retry() {
    setFailed(false);
    setReady(false);
    setAttempt((value) => value + 1);
  }

  return (
    <div className="location-picker">
      <div className="location-toolbar">
        <span>
          {pin
            ? `Pin: ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`
            : "No pin placed"}
        </span>
        <button
          type="button"
          onClick={useLocation}
          disabled={locating}
          data-testid={TESTIDS.reportUseLocation}
        >
          {locating ? "Locating…" : "Use my location"}
        </button>
      </div>
      <div className="location-map-wrap">
        <div
          key={attempt}
          className="location-map"
          ref={container}
          aria-label="Choose report location on map"
        />
        {failed && (
          <div className="location-map-error" role="alert">
            <p>
              The map couldn&apos;t load.
              {pin ? " Your pin is still saved." : ""}
            </p>
            <button type="button" onClick={retry}>
              Retry map
            </button>
          </div>
        )}
      </div>
      <p role="status" className={warning ? "location-warning" : undefined}>
        {message}
      </p>
    </div>
  );
}

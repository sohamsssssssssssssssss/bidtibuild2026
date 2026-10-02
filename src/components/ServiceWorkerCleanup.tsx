"use client";

import { useEffect } from "react";

/**
 * CivicPulse registers no service worker. A worker left on this origin by
 * another app (e.g. an earlier project on localhost:3000) can intercept page
 * and script requests and break hydration, so remove any we find.
 */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(
          registrations.map((registration) => registration.unregister()),
        ),
      )
      .catch(() => undefined);
  }, []);
  return null;
}

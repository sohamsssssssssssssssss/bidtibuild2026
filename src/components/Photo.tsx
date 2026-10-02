"use client";
/* eslint-disable @next/next/no-img-element -- Private report photos use the same-origin API. */

import { useState } from "react";

export function Photo({ src, alt }: { src: string | null; alt: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && src !== failedSrc ? (
    <img src={src} alt={alt} loading="lazy" onError={() => setFailedSrc(src)} />
  ) : (
    <span className="photo-fallback">Photo unavailable</span>
  );
}

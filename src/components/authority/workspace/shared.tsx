"use client";
/* eslint-disable @next/next/no-img-element -- Photos use the same-origin API photo route. */

import { useState } from "react";
import { AuthorityApiError } from "@/lib/authority/api";

/** The server's message for a failed call; never raw JSON. */
export function errorText(
  cause: unknown,
  fallback = "Something went wrong. Please retry.",
): string {
  if (cause instanceof AuthorityApiError) return cause.message;
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

export function isAuthError(cause: unknown): boolean {
  return (
    cause instanceof AuthorityApiError &&
    (cause.status === 401 ||
      cause.status === 403 ||
      cause.code === "UNAUTHENTICATED" ||
      cause.code === "FORBIDDEN")
  );
}

/** Inline error next to a control. The control itself stays usable. */
export function InlineError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="ap-error ws-inline-error" role="alert">
      {message}
    </p>
  );
}

/** Photo with a graceful fallback when the URL is missing or fails to load. */
export function Photo({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <div className={`photo-fallback ws-photo-fallback ${className ?? ""}`}>
        Photo unavailable
      </div>
    );
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Client IP hashing for rate limiting (02 §9):
 *   reporter_ip_hash = SHA-256(client IP + IP_HASH_SALT), lowercase hex.
 * The raw IP is never stored or logged; the salt is server-only (06 rule 27).
 */
import { createHash } from "node:crypto";
import { requiredEnv } from "./env";

/**
 * First entry of `x-forwarded-for`, else `x-real-ip`, else "unknown".
 * Trusts the platform proxy (Vercel overwrites these headers); behind no proxy
 * a client could spoof them, which only affects the per-IP limit — the per-user
 * limit still applies.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = req.headers.get("x-real-ip")?.trim();
  return real || "unknown";
}

/** SHA-256 hex of `ip + IP_HASH_SALT`. Throws (→ INTERNAL) when the salt is not configured. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(ip + requiredEnv("IP_HASH_SALT")).digest("hex");
}

/** `hashIp(clientIp(req))` — what the report-writing routes pass as `p_ip_hash`. */
export function clientIpHash(req: Request): string {
  return hashIp(clientIp(req));
}

/** Reads a required env var at call time (never at import time, so `next build` needs no env). */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

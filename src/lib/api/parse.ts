/** Input/output validation against the Zod contracts in src/contracts (02 §13). */
import type { z } from "zod";
import { searchParamsToObject } from "@/contracts/primitives";
import { ApiRouteError } from "./respond";

/** One readable line, e.g. `bbox: bbox must be minLng,minLat,maxLng,maxLat; status.0: Invalid option ...`. */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

function parseInput<S extends z.ZodType>(schema: S, input: unknown, what: string): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiRouteError("VALIDATION_FAILED", `Invalid ${what}: ${formatZodError(result.error)}`);
  return result.data;
}

/** Query string → schema (repeated keys / `[]` suffixes handled by `searchParamsToObject`). */
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  return parseInput(schema, searchParamsToObject(new URL(req.url).searchParams), "query");
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiRouteError("VALIDATION_FAILED", "Request body must be valid JSON");
  }
  return parseInput(schema, body, "body");
}

/** Dynamic route params (a Promise in Next 15+). */
export async function parseParams<S extends z.ZodType>(
  ctx: { params: Promise<unknown> },
  schema: S,
): Promise<z.output<S>> {
  return parseInput(schema, await ctx.params, "path parameter");
}

/**
 * Validates data coming back from the database before it is sent. Always on:
 * it is cheap at our sizes, catches SQL ↔ contract drift, and Zod strips keys
 * the schema doesn't know, which backs up the privacy rules (06 rule 22).
 * A mismatch is our bug, so it is logged and answered as INTERNAL.
 */
export function parseDbResult<S extends z.ZodType>(schema: S, data: unknown, source: string): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`${source} returned data that does not match the contract: ${formatZodError(result.error)}`);
  }
  return result.data;
}

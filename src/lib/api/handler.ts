import { ApiRouteError, respondFail } from "./respond";

/**
 * Top-level wrapper for route handlers: an `ApiRouteError` becomes its error
 * envelope; anything else is logged server-side and answered as a generic
 * INTERNAL error, so no details (SQL, stack, env) leak to the client.
 */
export function withApi<Ctx = unknown>(
  handler: (req: Request, ctx: Ctx) => Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiRouteError) return respondFail(err.code, err.message);
      console.error(`[api] ${req.method} ${new URL(req.url).pathname} failed:`, err);
      return respondFail("INTERNAL", "Something went wrong. Please try again.");
    }
  };
}

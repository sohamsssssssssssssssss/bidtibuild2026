/**
 * API contracts (02 §13). Every route validates its input with these schemas
 * and returns `ApiEnvelope<z.infer<response>>`. See routes.ts for the
 * route → schema map.
 */
export * from "./envelope";
export * from "./primitives";
export * from "./reports";
export * from "./issues";
export * from "./authority";
export * from "./hotspots";
export * from "./departments";
export * from "./routes";

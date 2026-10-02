/**
 * Loaded with `node --import` before the integration tests (see package.json
 * "test:integration"). Node's native type stripping needs full specifiers, but
 * src/contracts uses extensionless relative imports (`./primitives`,
 * `../config/civic`) for the Next.js bundler. This resolve hook retries a
 * missing relative specifier as `<spec>.ts`, then `<spec>/index.ts`.
 */
import { registerHooks } from "node:module";

const RELATIVE = /^\.{1,2}\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const notFound = (err as { code?: string }).code === "ERR_MODULE_NOT_FOUND";
      if (!notFound || !RELATIVE.test(specifier) || HAS_EXTENSION.test(specifier)) throw err;
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // try the next candidate
        }
      }
      throw err;
    }
  },
});

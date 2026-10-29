import { sourceLoader } from "../adapters/source-loader.mjs";

/** @type {Promise<Record<string, unknown>> | undefined} */
let loaded;
// The configuration readers, loaded once for an app's scripts that run under plain Node, so an app reads its
// config and test roots exactly as the commands do.
export function configuration() {
  return (loaded ??= sourceLoader.load(decodeURIComponent(new URL("../../..", import.meta.url).pathname).replace(/\/$/, ""), [
    "src/core/compositions/kit-configuration.ts",
    "src/core/readings/test-roots.ts",
  ]));
}

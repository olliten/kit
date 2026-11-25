import type { BrowserContext } from "playwright-core";
import { browserCapture } from "../src/substrate/adapters/browser-capture.js";
import { processes } from "../src/substrate/adapters/processes.js";
import { type BrowserProof, recordBrowserProof } from "../src/substrate/compositions/browser-proof.js";

// What an app's browser proof imports, as `kit/scripts/kit-browser.js`: start the capture on the proof's
// Playwright context, then call `done()` once before the context closes. Outside `kit verify`, which names the
// proof's report directory, nothing is captured or written.
export async function browserProof(context: BrowserContext, options: { readonly maps: string }): Promise<BrowserProof> {
  const variable = (name: string): string | undefined => processes.environment(name) || undefined;
  const environment = {
    coverage: variable("KIT_COVERAGE"),
    test: variable("KIT_TEST"),
    runtime: variable("KIT_RUNTIME"),
    root: variable("KIT_ROOT"),
    functions: variable("KIT_FUNCTIONS"),
  };
  if (environment.coverage === undefined || environment.test === undefined || environment.runtime === undefined)
    return { done: async () => {} };
  return recordBrowserProof(await browserCapture.start(context), options, environment);
}

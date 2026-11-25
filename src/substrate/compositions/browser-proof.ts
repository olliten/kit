import type { BrowserContextRecord } from "../../core/primitives/browser-execution.js";
import { browserMapOf } from "../../core/readings/browser-map.js";
import type { BrowserCaptureSession } from "../adapters/browser-capture.js";
import { textFiles } from "../adapters/text-files.js";

export interface BrowserProof {
  readonly done: () => Promise<void>;
}

// The proof's own environment as `kit verify` gives it: `KIT_COVERAGE`, `KIT_TEST` and `KIT_RUNTIME`.
export interface BrowserProofEnvironment {
  readonly coverage: string | undefined;
  readonly test: string | undefined;
  readonly runtime: string | undefined;
}

// What a started capture becomes once the proof is done: the test's browser runs and context, in its own report
// directory. Outside `kit verify` nothing is written.
export function recordBrowserProof(
  session: BrowserCaptureSession,
  options: { readonly maps: string },
  environment: BrowserProofEnvironment,
): BrowserProof {
  const { coverage, test, runtime } = environment;
  if (coverage === undefined || test === undefined || runtime === undefined) return { done: async () => {} };
  return {
    async done() {
      const captured = await session.take();
      const maps = textFiles.exists(options.maps) ? browserMapOf(JSON.parse(textFiles.read(options.maps))) : undefined;
      // No page function is attributed yet, so the capture is written incomplete, never left out.
      const attributed = false;
      const record: BrowserContextRecord = { complete: captured.complete && maps !== undefined && attributed, loaded: [], runtime };
      const directory = `${coverage}/${encodeURIComponent(test)}`;
      textFiles.directory(directory);
      textFiles.write(`${directory}/browser-context.json`, JSON.stringify(record));
    },
  };
}

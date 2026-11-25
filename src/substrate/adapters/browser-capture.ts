import type { BrowserContext } from "playwright-core";
import type { BrowserCapture as Captured } from "../../core/primitives/browser-execution.js";

export interface BrowserCaptureSession {
  readonly take: () => Promise<Captured>;
}

export interface BrowserCapture {
  readonly start: (context: BrowserContext) => Promise<BrowserCaptureSession>;
}

// Until precise coverage is captured page by page, every capture is incomplete: a proof that adopted it is
// never credited from what the page did not report.
export const browserCapture: BrowserCapture = {
  async start() {
    return { take: async () => ({ complete: false, scripts: [] }) };
  },
};

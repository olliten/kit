import type { BrowserContext, Page } from "playwright-core";
import type { BrowserCapture as Captured, BrowserCapturedScript } from "../../core/primitives/browser-execution.js";

export interface BrowserCaptureSession {
  readonly take: () => Promise<Captured>;
}

export interface BrowserCapture {
  readonly start: (context: BrowserContext) => Promise<BrowserCaptureSession>;
}

const origin = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? undefined : parsed.origin;
  } catch {
    return undefined;
  }
};

// A frame of another origin runs in another process, whose scripts the page's coverage does not hold.
const foreign = (page: string, frame: string): boolean => {
  const own = origin(page);
  const theirs = origin(frame);
  return own !== undefined && theirs !== undefined && own !== theirs;
};

// Precise function coverage, page by page, from before each page runs a script until the proof is done. A
// lifecycle it cannot follow, a worker, a service worker, a frame of another origin, a page gone before its
// coverage was taken or a browser that is not Chromium, leaves the capture incomplete rather than partial.
export const browserCapture: BrowserCapture = {
  async start(context) {
    let complete = context.browser()?.browserType().name() === "chromium";
    const pages: Page[] = [];
    const pending: Promise<void>[] = [];
    const follow = (page: Page): void => {
      pages.push(page);
      page.on("worker", () => (complete = false));
      page.on("crash", () => (complete = false));
      page.on("close", () => (complete = false));
      page.on("framenavigated", (frame) => {
        if (foreign(page.url(), frame.url())) complete = false;
      });
      pending.push(
        page.coverage
          .startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true })
          .catch(() => {
            complete = false;
          }),
      );
    };
    if (complete) {
      for (const page of context.pages()) {
        // A page open before the capture started may already have run code the coverage cannot show.
        if (page.url() !== "about:blank") complete = false;
        follow(page);
      }
      context.on("page", follow);
      context.on("serviceworker", () => (complete = false));
      if (context.serviceWorkers().length > 0) complete = false;
    }
    await Promise.all(pending);
    return {
      async take() {
        context.off("page", follow);
        await Promise.all(pending);
        const scripts: BrowserCapturedScript[] = [];
        for (const page of pages) {
          if (page.isClosed()) continue;
          for (const frame of page.frames()) if (foreign(page.url(), frame.url())) complete = false;
          try {
            for (const entry of await page.coverage.stopJSCoverage())
              scripts.push({ url: entry.url, source: entry.source ?? "", functions: entry.functions });
          } catch {
            complete = false;
          }
        }
        return { complete, scripts };
      },
    };
  },
};

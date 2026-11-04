import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { chromium } from "playwright-core";
import type { BrowserLaunch, BrowserRuntimeIdentity } from "../../core/primitives/browser-execution.js";

export interface OwnedBrowserServer extends BrowserRuntimeIdentity {
  readonly endpoint: string;
  readonly close: () => Promise<void>;
}

interface BrowserRuntime {
  readonly launch: (options: BrowserLaunch) => Promise<OwnedBrowserServer>;
}

export const browserRuntime: BrowserRuntime = {
  async launch(options) {
    const server = await chromium.launchServer({
      headless: options.headless,
      args: [...options.args],
    });
    try {
      const executable = realpathSync(server.process().spawnfile);
      const executableDigest = createHash("sha256").update(readFileSync(executable)).digest("hex");
      const connection = await chromium.connect(server.wsEndpoint());
      try {
        return {
          endpoint: server.wsEndpoint(),
          executableDigest,
          browserVersion: connection.version(),
          close: () => server.close(),
        };
      } finally {
        await connection.close();
      }
    } catch (error) {
      await server.close();
      throw error;
    }
  },
};

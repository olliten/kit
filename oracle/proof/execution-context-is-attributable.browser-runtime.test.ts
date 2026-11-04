import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { chromium, type Browser, type BrowserServer, type LaunchServerOptions } from "playwright-core";
import { afterEach, expect, test } from "vitest";
import { moduleDoubles } from "../substrate/adapters/module-doubles.js";

const servers: BrowserServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  moduleDoubles.restore();
});

async function nativeBoundary(failure?: "connect" | "version") {
  const state: {
    server?: BrowserServer;
    connection?: Browser;
    options?: LaunchServerOptions;
    serverCloses: number;
    connectionCloses: number;
  } = { serverCloses: 0, connectionCloses: 0 };
  const problem = new Error(`native ${failure ?? "identity"} failure`);
  moduleDoubles.replace("playwright-core", {
    chromium: {
      async launchServer(options: LaunchServerOptions) {
        state.options = options;
        const server = await chromium.launchServer(options);
        servers.push(server);
        state.server = server;
        return {
          process: () => server.process(),
          wsEndpoint: () => server.wsEndpoint(),
          async close() { state.serverCloses++; await server.close(); },
        };
      },
      async connect(endpoint: string) {
        if (failure === "connect") throw problem;
        const connection = await chromium.connect(endpoint);
        state.connection = connection;
        return {
          version() {
            if (failure === "version") throw problem;
            return connection.version();
          },
          async close() { state.connectionCloses++; await connection.close(); },
        };
      },
    },
  });
  const { browserRuntime } = await import("../../src/substrate/adapters/browser-runtime.js");
  return { browserRuntime, state, problem };
}

test("an owned runtime attests the exact process executable and independently observed browser version", async () => {
  const { browserRuntime, state } = await nativeBoundary();
  const args = ["--no-sandbox"];
  const owned = await browserRuntime.launch({ headless: true, args });
  const native = state.server;
  if (native === undefined) throw new Error("no native browser server was acquired");
  expect(state.options).toEqual({ headless: true, args });
  expect(state.options?.args).not.toBe(args);
  expect(owned.endpoint).toBe(native.wsEndpoint());
  expect(owned.executableDigest).toBe(
    createHash("sha256").update(readFileSync(realpathSync(native.process().spawnfile))).digest("hex"),
  );
  expect(state.connectionCloses).toBe(1);
  expect(state.connection?.isConnected()).toBe(false);
  expect(native.process().exitCode).toBeNull();
  const observer = await chromium.connect(owned.endpoint);
  try {
    expect(owned.browserVersion).not.toBe("");
    expect(owned.browserVersion).toBe(observer.version());
  } finally {
    await observer.close();
  }
  await owned.close();
  expect(state.serverCloses).toBe(1);
  expect(native.process().exitCode !== null || native.process().signalCode !== null).toBe(true);
});

test("metadata connection failure rejects the launch and closes the real acquired server", async () => {
  const { browserRuntime, state, problem } = await nativeBoundary("connect");
  await expect(browserRuntime.launch({ headless: true, args: ["--no-sandbox"] })).rejects.toBe(problem);
  const native = state.server;
  if (native === undefined) throw new Error("the failing launch acquired no native server");
  expect(state.serverCloses).toBe(1);
  expect(state.connectionCloses).toBe(0);
  expect(native.process().exitCode !== null || native.process().signalCode !== null).toBe(true);
});

test("version observation failure closes both the native metadata connection and its owned server", async () => {
  const { browserRuntime, state, problem } = await nativeBoundary("version");
  await expect(browserRuntime.launch({ headless: true, args: ["--no-sandbox"] })).rejects.toBe(problem);
  const native = state.server;
  if (native === undefined) throw new Error("the failing observation acquired no native server");
  expect(state.connectionCloses).toBe(1);
  expect(state.connection?.isConnected()).toBe(false);
  expect(state.serverCloses).toBe(1);
  expect(native.process().exitCode !== null || native.process().signalCode !== null).toBe(true);
});

import { afterEach, expect, test } from "vitest";
import { moduleDoubles } from "../substrate/adapters/module-doubles.js";

async function boundary() {
  const calls: { create: unknown[][]; server: unknown[][]; runner: unknown[][]; fetch: unknown[][];
    resolve: unknown[][]; execute: string[]; spawn: unknown[][]; closed: number } = {
    create: [], server: [], runner: [], fetch: [], resolve: [], execute: [], spawn: [], closed: 0,
  };
  const state: { command: Record<string, unknown>; input: Record<string, unknown>; childStatus: number | null } = {
    command: {}, input: {}, childStatus: 0,
  };
  moduleDoubles.configure({ argv: [moduleDoubles.runtime().execPath, "/governed/scripts/command.mjs", "alpha", "β"],
    execArgv: [], nodeOptions: "--max-old-space-size=4096", exitCode: undefined });
  moduleDoubles.replace("vite", { async createServer(...args: unknown[]) {
    calls.create.push(args);
    return { config: { base: "/sdk-base/" }, async close() { calls.closed++; } };
  } });
  moduleDoubles.replace("vite-node/server", { ViteNodeServer: class {
    constructor(...args: unknown[]) { calls.server.push(args); }
    fetchModule(...args: unknown[]) { calls.fetch.push(args); }
    resolveId(...args: unknown[]) { calls.resolve.push(args); }
  } });
  moduleDoubles.replace("vite-node/client", { ViteNodeRunner: class {
    constructor(...args: unknown[]) { calls.runner.push(args); }
    async executeFile(path: string) {
      calls.execute.push(path);
      return path.endsWith("terminal-input.ts") ? { terminalInput: state.input } : state.command;
    }
  } });
  moduleDoubles.replace("node:child_process", { spawnSync(...args: unknown[]) {
    calls.spawn.push(args);
    return { status: state.childStatus };
  } });
  moduleDoubles.replace("node:v8", { getHeapStatistics: () => ({ heap_size_limit: 1024 }) });
  return { calls, state, sourceLoader: (await import("../../src/substrate/adapters/source-loader.mjs")).sourceLoader };
}

afterEach(() => { moduleDoubles.restore(); });

test("the actual launcher boundary forwards caller data and terminal input, renders the response and closes its SDK", async () => {
  const { calls, state, sourceLoader } = await boundary();
  const commandCalls: unknown[][] = [];
  state.input = { read: () => "input text" };
  state.command = { async command(...args: unknown[]) {
    commandCalls.push(args);
    return { stdout: "answer\n", stderr: "warning\n", exitCode: 7 };
  } };
  const output = moduleDoubles.capture();
  await sourceLoader.run("file:///governed/scripts/command.mjs", "src/command.ts", "command");
  expect(commandCalls).toEqual([[{ engineRoot: "/governed", args: ["alpha", "β"], cwd: moduleDoubles.runtime().cwd }, state.input]]);
  expect(output.stdout).toContain("answer\n");
  expect(output.stderr).toContain("warning\n");
  expect(moduleDoubles.runtime().exitCode).toBe(7);
  expect(calls.create).toEqual([[{ root: "/governed", configFile: false, envFile: false,
    css: { postcss: { plugins: [] } }, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null } }]]);
  expect(calls.server).toEqual([[expect.objectContaining({ config: { base: "/sdk-base/" } }), {
    deps: { external: ["typescript", "mdast-util-from-markdown"] },
  }]]);
  const runnerOptions = calls.runner[0]?.[0];
  expect(runnerOptions).toMatchObject({ root: "/governed", base: "/sdk-base/" });
  if (typeof runnerOptions !== "object" || runnerOptions === null) throw new Error("runner options absent");
  const fetch = Reflect.get(runnerOptions, "fetchModule");
  const resolve = Reflect.get(runnerOptions, "resolveId");
  if (typeof fetch !== "function" || typeof resolve !== "function") throw new Error("runner callbacks absent");
  await fetch("source.ts");
  await resolve("source.ts", "importer.ts");
  expect(calls.fetch).toEqual([["source.ts"]]);
  expect(calls.resolve).toEqual([["source.ts", "importer.ts"]]);
  expect(calls.execute).toEqual(["/governed/src/command.ts", "/governed/src/substrate/adapters/terminal-input.ts"]);
  expect(calls.closed).toBe(1);
});

test("missing exports and failing commands close the acquired server and remain failures", async () => {
  const { calls, state, sourceLoader } = await boundary();
  await expect(sourceLoader.run("file:///governed/scripts/command.mjs", "src/command.ts", "missing")).rejects.toThrow("src/command.ts exports no missing");
  expect(calls.closed).toBe(1);
  state.command = { command: async () => { throw new Error("command failed"); } };
  await expect(sourceLoader.run("file:///governed/scripts/command.mjs", "src/command.ts", "command")).rejects.toThrow("command failed");
  expect(calls.closed).toBe(2);
});

test.each([0, 9, null])("heap restart preserves the executable and caller arguments with child status %s", async (status) => {
  const { calls, state, sourceLoader } = await boundary();
  moduleDoubles.configure({ execArgv: [], nodeOptions: "" });
  state.childStatus = status;
  await sourceLoader.run("file:///governed/scripts/command.mjs", "src/command.ts", "command");
  const runtime = moduleDoubles.runtime();
  expect(calls.spawn).toEqual([[runtime.execPath,
    ["--max-old-space-size=4096", ...runtime.execArgv, ...runtime.argv.slice(1)], { stdio: "inherit" }]]);
  expect(runtime.exitCode).toBe(status ?? 1);
  expect(calls.create).toEqual([]);
});

import { resolve } from "node:path";
import { expect, test } from "vitest";

import { kitCheckPaths } from "../../src/core/readings/check-paths.js";
import { sourceLoader } from "../../src/substrate/adapters/source-loader.mjs";

const engine = "/opt/kit";
const app = "/work/app";

test("relative paths a caller gives resolve against the caller's directory, not the Kit's", () => {
  expect(
    kitCheckPaths(["--root=.", "--config=kit/config.md", "--baseline", "kit/debt/legacy.json"], engine, app),
  ).toEqual({
    root: app,
    configPath: resolve(app, "kit/config.md"),
    baselinePath: resolve(app, "kit/debt/legacy.json"),
  });
});

test("absolute paths stay as given", () => {
  expect(
    kitCheckPaths(["--root=/srv/a", "--config=/srv/a/c.md", "--baseline=/srv/a/b.json"], engine, app),
  ).toEqual({ root: "/srv/a", configPath: "/srv/a/c.md", baselinePath: "/srv/a/b.json" });
});

test("with no paths the Kit checks itself, wherever it is called from", () => {
  expect(kitCheckPaths([], engine, app)).toEqual({
    root: engine,
    configPath: resolve(engine, "self-config.md"),
    baselinePath: resolve(engine, "self-debt/legacy"),
  });
});

test("another root still needs its own config and baseline", () => {
  expect(() => kitCheckPaths(["--root=."], engine, app)).toThrow(/--config and --baseline/);
});

test("a launcher gives its command a 4 GB heap unless the caller set a heap size", () => {
  const small = 2 * 1024 ** 3;
  expect(sourceLoader.heapFlag([], "", small)).toBe("--max-old-space-size=4096");
  expect(sourceLoader.heapFlag(["--max-old-space-size=2048"], "", small)).toBeNull();
  expect(sourceLoader.heapFlag([], "--import x.mjs --max-old-space-size=1024", small)).toBeNull();
  expect(sourceLoader.heapFlag([], "--import x.mjs", 8 * 1024 ** 3)).toBeNull();
});

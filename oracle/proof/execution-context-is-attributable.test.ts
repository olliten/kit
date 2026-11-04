import { expect, test } from "vitest";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { executionContext, executionContextOf } from "../../src/core/readings/execution-context.js";
import { recordedFunctions } from "../substrate/compositions/recorded-functions.js";

const root = "/app";
const runtime = "node-runtime";
const coverage = (...urls: string[]) => JSON.stringify({ result: urls.map((url) => ({ url, functions: [] })) });

test("attributable loads retain normalized original sources across process and supplemental captures", () => {
  const uses = new Map([
    ["oracle/read/proves.test.ts", new Set(["load"])],
    ["src/core/readings/metadata.ts", new Set(["read"])],
  ]);
  expect(executionContext(uses, [coverage("file:///app/src/core/readings/value.ts", "node:internal/modules/loader", "file:///outside/tool.mjs")], root, runtime, [{
    complete: true, loaded: ["src/shell/readings/browser-value.ts"], runtime,
  }])).toEqual({
    complete: true, runtime,
    loaded: ["oracle/read/proves.test.ts", "src/core/readings/value.ts", "src/shell/readings/browser-value.ts"],
  });
});

test("missing capture, unknown runtime scripts and malformed source identities remain incomplete", () => {
  expect(executionContext(new Map(), [], root, runtime).complete).toBe(false);
  for (const report of ["not-json", "{}", coverage("https://app.test/bundle.js"), coverage(""), coverage("file:///app/%not-valid")])
    expect(executionContext(new Map(), [report], root, runtime).complete, report).toBe(false);
  expect(executionContext(new Map([["../outside.ts", new Set(["load"])]]), [coverage("node:internal/main")], root, runtime).complete).toBe(false);
});

test("query strings and escaped paths cannot conceal the identity of an application bootstrap", () => {
  expect(executionContext(new Map(), [coverage("file:///app/src/start.ts?fresh=1#reload")], root, runtime)).toEqual({
    complete: true, runtime, loaded: ["src/start.ts"],
  });
  expect(executionContext(new Map(), [coverage("file:///my%20app/src/reader.ts")], "/my app", runtime)).toEqual({
    complete: true, runtime, loaded: ["src/reader.ts"],
  });
});

test("an incomplete or foreign-runtime page capture cannot be repaired by a complete Node capture", () => {
  for (const supplemental of [
    { complete: false, runtime, loaded: ["src/client/app.ts"] },
    { complete: true, runtime: "different-runtime", loaded: ["src/client/app.ts"] },
  ]) expect(executionContext(new Map(), [coverage("file:///app/oracle/read/proves.test.ts")], root, runtime, [supplemental]).complete).toBe(false);
});

test("stored execution contexts reject ambiguous paths and preserve explicit incompleteness", () => {
  expect(executionContextOf({ complete: false, runtime, loaded: ["src/a.ts", "src/a.ts"] })).toEqual({ complete: false, runtime, loaded: ["src/a.ts"] });
  for (const value of [null, {}, { complete: true, runtime: "", loaded: [] }, ...[
    "/app/src/a.ts", "../src/a.ts", "./src/a.ts", "src//a.ts", "src\\a.ts", "",
  ].map((path) => ({ complete: true, runtime, loaded: [path] }))]) expect(executionContextOf(value), JSON.stringify(value)).toBeUndefined();
});

test("bootstrap declarations are exact checked sources and grant no entrypoint exception", () => {
  const roots = { src: "src", spec: "spec", oracle: "oracle" };
  expect(configuredKit(DEFAULT_CONFIG, { roots, bootstraps: ["src/client/app.ts", "src/index.ts"] })).toMatchObject({ bootstraps: ["src/client/app.ts", "src/index.ts"] });
  expect(configuredKit(DEFAULT_CONFIG, { roots, bootstraps: ["src/client/app.ts"] }).exceptions).toEqual([]);
  expect(configuredKit(DEFAULT_CONFIG, { roots, bootstraps: [] }).bootstraps).toEqual([]);
  expect(configuredKit(DEFAULT_CONFIG, { roots }).bootstraps).toBeUndefined();
  for (const bootstraps of [["src/app.ts", "src/app.ts"], ["../app.ts"], ["src/"], ["src/*.ts"], ["./src/app.ts"], "src/app.ts"])
    expect(() => configuredKit(DEFAULT_CONFIG, { roots, bootstraps })).toThrow();
});

test("compiler function spans identify the original nested named source rather than reconstructed snippets", () => {
  const file = "src/core/readings/value.ts";
  const text = "// leading comment\nexport function outer(value: number): number {\n  function inner(n: number): number { return n + 1; }\n  return inner(value);\n}\n";
  const functions = recordedFunctions({ [file]: text }).functions ?? [];
  expect(functions.map(({ id }) => id)).toEqual(["outer", "outer.inner"]);
  const [outer, inner] = functions;
  expect(text.slice(outer?.start, outer?.end)).toBe("export function outer(value: number): number {\n  function inner(n: number): number { return n + 1; }\n  return inner(value);\n}");
  expect(text.slice(inner?.start, inner?.end)).toBe("function inner(n: number): number { return n + 1; }");
});

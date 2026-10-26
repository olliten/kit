import { expect, test } from "vitest";
import { behaviourCheck } from "../../src/core/readings/behaviour-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

// The globals and accesses a fixture records, and what the core composition it hands a callback is found to
// take; a fixture that doesn't compile throws.
function inspect(source: string, declarations: Readonly<Record<string, string>> = {}) {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022", "DOM"],
        types: [],
        strict: true,
        noEmit: true,
        declaration: true,
        isolatedDeclarations: true,
      },
      include: ["src/**/*.ts"],
    }),
    "src/core/compositions/run.ts":
      "export function run(callback: () => void): void { callback(); }\n",
    "src/legacy/main.ts": source,
    ...declarations,
  };
  const { globals, accesses } = recordedAuthority(files);
  return {
    accesses,
    globals,
    findings: behaviourCheck(projectSnapshot(recordedImports(files))),
  };
}

test("a Window namespace does not grant every constructor exposed by globalThis", () => {
  const result = inspect("export function main(): Window { return window; }\n");
  const observations = result.globals.filter(
    (global) => global.file === "src/legacy/main.ts" && global.name === "window",
  );
  expect(observations.length).toBeGreaterThan(0);
  for (const observation of observations) {
    expect(observation.nativeAuthority?.map((authority) => authority.root.name)).toEqual([
      "Window",
    ]);
  }
});

test("an ambient constructor declaration does not expand a Window namespace footprint", () => {
  const result = inspect("export function main(): Window { return window; }\n", {
    "src/ambient.d.ts": "declare var AmbientConstructor: typeof AbortController;\n",
  });
  const observations = result.globals.filter(
    (global) => global.file === "src/legacy/main.ts" && global.name === "window",
  );
  expect(observations.length).toBeGreaterThan(0);
  for (const observation of observations) {
    expect(observation.nativeAuthority?.map((authority) => authority.root.name)).toEqual([
      "Window",
    ]);
  }
});

test("a method-free SDK holder retains its ports' authority when constructed in Core", () => {
  const result = inspect(
    "import { run } from '../core/compositions/run.js';\n" +
      "export function main(): void { run(() => { void new MessageChannel(); }); }\n",
  );
  expect(
    result.globals
      .filter((global) => global.file === "src/legacy/main.ts" && global.name === "MessageChannel")
      .flatMap((global) => global.nativeAuthority ?? [])
      .map((authority) => authority.root.name),
  ).toContain("MessagePort");
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "src/core/compositions/run.ts", rule: "R1", blocking: true }),
    ]),
  );
});

test("selecting a namespace constructor still blocks its invocation in Core", () => {
  const result = inspect(
    "import { run } from '../core/compositions/run.js';\n" +
      "export function main(api: typeof globalThis): void { run(() => { void new api.WebSocket('wss://example.invalid'); }); }\n",
  );
  expect(
    result.accesses
      .filter((access) => access.file === "src/legacy/main.ts")
      .flatMap((access) => access.nativeAuthority ?? [])
      .map((authority) => authority.root.name),
  ).toContain("WebSocket");
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "src/core/compositions/run.ts", rule: "R1", blocking: true }),
    ]),
  );
});

test("selecting an authored ambient constructor retains its actual SDK authority", () => {
  const result = inspect(
    "import { run } from '../core/compositions/run.js';\n" +
      "export function main(api: typeof globalThis): void { run(() => { void new api.AmbientConstructor(); }); }\n",
    { "src/ambient.d.ts": "declare var AmbientConstructor: typeof AbortController;\n" },
  );
  expect(
    result.accesses
      .filter((access) => access.file === "src/legacy/main.ts")
      .flatMap((access) => access.nativeAuthority ?? [])
      .map((authority) => authority.root.name),
  ).toContain("AbortController");
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "src/core/compositions/run.ts", rule: "R1", blocking: true }),
    ]),
  );
});

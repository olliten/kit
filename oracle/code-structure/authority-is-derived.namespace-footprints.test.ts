import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

const gateSource =
  process.env.KIT_GATE_SOURCE ?? new URL("../../../scripts/kit-check.mjs", import.meta.url).href;
const { ratchetFindings } = await import(gateSource);

function inspect(source: string, declarations: Readonly<Record<string, string>> = {}) {
  const root = mkdtempSync(join(tmpdir(), "kit-namespace-footprint-"));
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
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const snapshot = readSnapshot(root, DEFAULT_CONFIG);
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    return {
      snapshot,
      findings: capabilityCheck(snapshot).findings,
      globals: snapshot.compiler?.projects.flatMap((project) => project.globals) ?? [],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  expect(
    ratchetFindings(result.findings, [], ["src/core/compositions/run.ts"], result.snapshot.imports),
  ).toEqual(
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
    result.snapshot.compiler?.projects
      .flatMap((project) => project.accesses)
      .filter((access) => access.file === "src/legacy/main.ts")
      .flatMap((access) => access.nativeAuthority ?? [])
      .map((authority) => authority.root.name),
  ).toContain("WebSocket");
  expect(
    ratchetFindings(result.findings, [], ["src/core/compositions/run.ts"], result.snapshot.imports),
  ).toEqual(
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
    result.snapshot.compiler?.projects
      .flatMap((project) => project.accesses)
      .filter((access) => access.file === "src/legacy/main.ts")
      .flatMap((access) => access.nativeAuthority ?? [])
      .map((authority) => authority.root.name),
  ).toContain("AbortController");
  expect(
    ratchetFindings(result.findings, [], ["src/core/compositions/run.ts"], result.snapshot.imports),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "src/core/compositions/run.ts", rule: "R1", blocking: true }),
    ]),
  );
});

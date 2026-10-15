import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

function inspect(files: Readonly<Record<string, string>>) {
  const root = mkdtempSync(join(tmpdir(), "kit-callback-boundary-"));
  try {
    const inputs = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022"],
          types: [],
          strict: true,
          noEmit: true,
          declaration: true,
          isolatedDeclarations: true,
        },
        include: ["src/**/*.ts"],
      }),
      "src/core/compositions/run.ts":
        "export function run(read: () => number): number { return read(); }\n",
      "src/core/readings/value.ts": "export function value(): number { return 7; }\n",
      "src/substrate/adapters/clock.ts":
        "export interface Clock { now(): number; }\n" +
        "export const clock: Clock = { now: () => Date.now() };\n",
      ...files,
    };
    for (const [path, content] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const snapshot = readSnapshot(root, {
      ...DEFAULT_CONFIG,
      adapters: [
        {
          module: "substrate/adapters/clock",
          export: "clock",
          capability: "clock.read",
          kind: "external",
          zones: ["substrate"],
          contract: { type: "Clock" },
          primitives: ["clock"],
        },
      ],
    });
    expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
    return capabilityCheck(snapshot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const coreImport = "import { run } from '../../core/compositions/run.js';\n";
const clockImport = "import { clock } from '../adapters/clock.js';\n";
const pureImport = "import { value } from '../../core/readings/value.js';\n";
const relayImport = "import { relay } from './relay.js';\n";
const recordRun =
  "export function run(input: { readonly read: () => number }): number { return input.read(); }\n";

test("an extended array of plain data has no executable input capability", () => {
  expect(
    inspect({
      "src/core/readings/value.ts":
        "interface Values extends ReadonlyArray<number> { readonly label: string; }\n" +
        "export function value(input: Values): number { return input[0] ?? 0; }\n",
    }).findings,
  ).toEqual([]);
});

test("an array's custom executable member is not a standard array operation", () => {
  const result = inspect({
    "src/core/compositions/run.ts": recordRun,
    "src/substrate/compositions/probe.ts":
      `${coreImport}${clockImport}` +
      "interface Reader extends Array<number> { read(): number; }\n" +
      "const input: Reader = Object.assign([1], { read: () => clock.now() });\n" +
      "export const result: number = run(input);\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ blocking: true })]),
  );
});

test("an application override of an array operation retains its clock authority", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(input: Array<number>): number { return input.at(0) ?? 0; }\n",
    "src/substrate/compositions/probe.ts":
      `${coreImport}${clockImport}class Values extends Array<number> { at(index: number): number { return clock.now(); } }\n` +
      "export const result: number = run(new Values());\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
});

test("a getter carrying the clock cannot be invoked inside Core", () => {
  const result = inspect({
    "src/core/compositions/run.ts":
      "export function run(input: { readonly value: number }): number { return input.value; }\n",
    "src/substrate/compositions/probe.ts": `${coreImport}${clockImport}export const result: number = run({ get value(): number { return clock.now(); } });\n`,
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
});

test("a method-bearing instance carrying the clock cannot be invoked inside Core", () => {
  const result = inspect({
    "src/core/compositions/run.ts": recordRun,
    "src/substrate/compositions/probe.ts":
      `${coreImport}${clockImport}class Reader { read(): number { return clock.now(); } }\n` +
      "export const result: number = run(new Reader());\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
});

test.each([false, true])(
  "a clock closure cannot enter Core through a plain callback, relay=%s",
  (relay) => {
    const result = inspect({
      ...(relay
        ? {
            "src/substrate/compositions/relay.ts": `${coreImport}export function relay(read: () => number): number { return run(read); }\n`,
          }
        : {}),
      "src/substrate/compositions/probe.ts":
        `${relay ? relayImport : coreImport}${clockImport}` +
        `export const result: number = ${relay ? "relay" : "run"}(() => clock.now());\n`,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
    );
  },
);

test("a registered clock parameter retains authority when wrapped in a callback", () => {
  const result = inspect({
    "src/substrate/compositions/relay.ts":
      `${coreImport}import type { Clock } from '../adapters/clock.js';\n` +
      "export function relay(clock: Clock): number { return run(() => clock.now()); }\n",
    "src/substrate/compositions/probe.ts": `${relayImport}${clockImport}export const result: number = relay(clock);\n`,
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
});

test.each([false, true])("a clock method in a record cannot enter Core, relay=%s", (relay) => {
  const result = inspect({
    "src/core/compositions/run.ts": recordRun,
    ...(relay
      ? {
          "src/substrate/compositions/relay.ts": `${coreImport}export function relay(input: { readonly read: () => number }): number { return run(input); }\n`,
        }
      : {}),
    "src/substrate/compositions/probe.ts":
      `${relay ? relayImport : coreImport}${clockImport}` +
      `export const result: number = ${relay ? "relay" : "run"}({ read: () => clock.now() });\n`,
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
});

test.each([false, true])("an imported pure callback remains supported, relay=%s", (relay) => {
  expect(
    inspect({
      ...(relay
        ? {
            "src/substrate/compositions/relay.ts": `${coreImport}export function relay(read: () => number): number { return run(read); }\n`,
          }
        : {}),
      "src/substrate/compositions/probe.ts":
        `${relay ? relayImport : coreImport}${pureImport}` +
        `export const result: number = ${relay ? "relay" : "run"}(value);\n`,
    }).findings,
  ).toEqual([]);
});

test("a record containing an imported pure callback remains supported", () => {
  expect(
    inspect({
      "src/core/compositions/run.ts": recordRun,
      "src/substrate/compositions/probe.ts": `${coreImport}${pureImport}export const result: number = run({ read: value });\n`,
    }).findings,
  ).toEqual([]);
});

test.each([false, true])(
  "an unbound callback relay remains unresolved, recursive=%s",
  (recursive) => {
    const result = inspect({
      "src/substrate/compositions/relay.ts":
        `${coreImport}export function relay(read: () => number, count: number): number { ` +
        `${recursive ? "if (count > 0) return relay(read, count - 1); " : ""}return run(read); }\n`,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "unresolved", blocking: true })]),
    );
  },
);

test("a registered member does not establish an unrelated executable member's authority", () => {
  const result = inspect({
    "src/substrate/compositions/relay.ts":
      `${coreImport}import type { Clock } from '../adapters/clock.js';\n` +
      "export function relay(input: { readonly clock: Clock; readonly read: () => number }): number { return run(input.read); }\n",
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "unresolved", blocking: true })]),
  );
});

test("one known caller does not establish another public callback boundary in the same module", () => {
  const result = inspect({
    "src/substrate/compositions/relay.ts":
      `${coreImport}export function relay(read: () => number): number { return run(read); }\n` +
      "export function unknown(read: () => number): number { return run(read); }\n",
    "src/substrate/compositions/probe.ts": `${relayImport}${pureImport}export const result: number = relay(value);\n`,
  });
  expect(result.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "unresolved", blocking: true })]),
  );
});

test.each([false, true])(
  "a constrained generic retains a supplied clock closure, record=%s",
  (record) => {
    const result = inspect({
      ...(record ? { "src/core/compositions/run.ts": recordRun } : {}),
      "src/substrate/compositions/relay.ts": `${coreImport}export function relay<T extends ${record ? "{ readonly read: () => number }" : "() => number"}>(input: T): number { return run(input); }\n`,
      "src/substrate/compositions/probe.ts": `${relayImport}${clockImport}export const result: number = relay(${record ? "{ read: () => clock.now() }" : "() => clock.now()"});\n`,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
    );
  },
);

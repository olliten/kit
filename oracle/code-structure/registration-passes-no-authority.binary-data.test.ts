import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

const kit = fileURLToPath(new URL("../..", import.meta.url));

// Node's types are loaded so that Buffer, which extends Uint8Array, is declared beside the typed arrays.
function findings(files: Readonly<Record<string, string>>): readonly string[] {
  const root = mkdtempSync(join(tmpdir(), "kit-binary-data-"));
  try {
    const inputs = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM"],
          types: ["node"],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
      "package.json": JSON.stringify({ type: "module" }),
      "src/substrate/adapters/clock.ts":
        "export interface Clock { now(): number; }\nexport const clock: Clock = { now: () => Date.now() };\n",
      ...files,
    };
    for (const [path, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    mkdirSync(join(root, "node_modules"));
    symlinkSync(join(kit, "node_modules/@types"), join(root, "node_modules/@types"));
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
    return capabilityCheck(snapshot).findings.map((finding) => finding.debtKey);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a reading's typed arrays, buffers and views are data", () => {
  expect(
    findings({
      "src/core/readings/size.ts":
        "export function size(bytes: Uint8Array, words: Int32Array, wide: BigUint64Array, real: Float64Array, view: DataView, buffer: ArrayBuffer, shared: SharedArrayBuffer): number { return bytes.subarray(1).length + words.indexOf(1) + wide.length + real.reduce((sum, value) => sum + value, 0) + view.getUint8(0) + buffer.slice(0).byteLength + shared.byteLength; }\n",
      "src/core/readings/key.ts":
        "export function key(input: { readonly wrapKey: Uint8Array; readonly keys: readonly Uint8Array[] }): number { return input.wrapKey.length + input.keys.length; }\n",
    }),
  ).toEqual([]);
});

test("typed arrays passed to a Core composition are data", () => {
  expect(
    findings({
      "src/core/compositions/seal.ts":
        "export function seal(key: Uint8Array, options: { readonly wrapKey: Uint8Array }): number { return key.length + options.wrapKey.length; }\n",
      "src/substrate/compositions/caller.ts":
        "import { seal } from '../../core/compositions/seal.js';\n" +
        "export function call(bytes: Uint8Array): number { return seal(new Uint8Array(4), { wrapKey: bytes }) + seal(bytes, { wrapKey: bytes.subarray(1) }); }\n",
    }),
  ).toEqual([]);
});

test("a reading's Buffer is still supplied behaviour", () => {
  expect(
    findings({
      "src/core/readings/size.ts":
        "export function size(bytes: Buffer): number { return bytes.length; }\n",
    }),
  ).toEqual(["R1:reading-callable:src/core/readings/size.ts:bytes"]);
});

test("a Buffer passed to a Core composition still binds", () => {
  expect(
    findings({
      "src/core/compositions/seal.ts":
        "export function seal(key: Uint8Array): number { return key.length; }\n",
      "src/substrate/compositions/caller.ts":
        "import { seal } from '../../core/compositions/seal.js';\n" +
        "export function call(bytes: Buffer): number { return seal(bytes); }\n",
    }),
  ).toEqual([
    expect.stringMatching(
      /^R1:callable-binding:src\/substrate\/compositions\/caller\.ts:src\/core\/compositions\/seal\.ts:/,
    ),
  ]);
});

test("Buffer used as a value is still an ambient global", () => {
  expect(
    findings({
      "src/core/readings/text.ts":
        "export function text(bytes: Uint8Array): string { return Buffer.from(bytes).toString('base64url'); }\n",
    }),
  ).toEqual(["R1:ambient-global:src/core/readings/text.ts:Buffer"]);
});

test("a typed array subclass that adds a method is supplied behaviour", () => {
  expect(
    findings({
      "src/core/primitives/bytes.ts":
        "export class Bytes extends Uint8Array { now(): number { return this.length; } }\n",
      "src/core/readings/size.ts":
        "import type { Bytes } from '../primitives/bytes.js';\n" +
        "export function size(bytes: Bytes): number { return bytes.now(); }\n",
    }),
  ).toEqual(expect.arrayContaining(["R1:reading-callable:src/core/readings/size.ts:bytes"]));
});

test("a record holding typed arrays beside a clock callback still binds", () => {
  expect(
    findings({
      "src/core/compositions/run.ts":
        "export function run(input: { readonly bytes: Uint8Array; readonly read: () => number }): number { return input.bytes.length + input.read(); }\n",
      "src/substrate/compositions/caller.ts":
        "import { run } from '../../core/compositions/run.js';\nimport { clock } from '../adapters/clock.js';\n" +
        "export const result: number = run({ bytes: new Uint8Array(1), read: () => clock.now() });\n",
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^R1:(?:callable|closure)-binding:src\/substrate\/compositions\/caller\.ts:/),
    ]),
  );
});

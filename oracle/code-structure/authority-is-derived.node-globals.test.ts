import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

const kit = fileURLToPath(new URL("../..", import.meta.url));

function authority(source: string) {
  const root = mkdtempSync(join(tmpdir(), "kit-node-globals-"));
  try {
    const inputs = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022"],
          types: ["node"],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
      "package.json": JSON.stringify({ type: "module" }),
      "src/core/readings/read.ts": source,
    };
    for (const [path, text] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    mkdirSync(join(root, "node_modules"));
    symlinkSync(join(kit, "node_modules/@types"), join(root, "node_modules/@types"));
    return capabilityCheck(readSnapshot(root, DEFAULT_CONFIG))
      .findings.filter((finding) => finding.path === "src/core/readings/read.ts")
      .map((finding) => finding.debtKey.split(":").slice(0, 2).join(":"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.each([
  ["a Node global", 'export function read(): unknown { return process.getBuiltinModule("node:fs"); }\n'],
  [
    "a Node global reached through globalThis",
    'export function read(): unknown { return globalThis.process.getBuiltinModule("node:fs"); }\n',
  ],
])("%s is host authority, never evidence of purity", (_, source) => {
  expect(authority(source)).toContain("R1:ambient-global");
});

test("a cast of globalThis erases which global is reached, so it remains an explicit limit", () => {
  expect(
    authority(
      'export function read(): unknown { return (globalThis as any).process.getBuiltinModule("node:fs"); }\n',
    ),
  ).toContain("R1:authority-entry");
});

test("pure arithmetic on supplied data acquires no authority", () => {
  expect(
    authority("export function read(values: readonly number[]): number { return Math.max(0, ...values); }\n"),
  ).toEqual([]);
});

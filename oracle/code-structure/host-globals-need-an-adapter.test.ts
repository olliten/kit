import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";

const path = "src/core/readings/read.ts";

// What the reading's own globals and accesses acquire; a fixture that doesn't compile throws.
function authority(source: string): string[] {
  const facts = recordedAuthority({
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        lib: ["ES2022"],
        types: ["node"],
        typeRoots: [fileURLToPath(new URL("../../node_modules/@types", import.meta.url))],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["src/**/*.ts"],
    }),
    "package.json": JSON.stringify({ type: "module" }),
    [path]: source,
  });
  const snapshot = projectSnapshot(facts);
  const context = capabilityContext(snapshot, []);
  return [accessAuthority(snapshot, context), globalAuthority(snapshot, context)]
    .flatMap((part) => part.findings)
    .filter((finding) => finding.path === path)
    .map((finding) => finding.debtKey.split(":").slice(0, 2).join(":"));
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

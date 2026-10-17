import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../lib/source-fixture.js";

const adapter = "src/substrate/adapters/file-access.ts";
const adapterSource =
  'import { readFileSync } from "node:fs";\n' +
  "export interface FileAccess { read(path: string): string; size(text: string): number; directory(): string; }\n" +
  "export const fileAccess: FileAccess = {\n" +
  '  read: (path) => readFileSync(path, "utf8"),\n' +
  '  size: (text) => Buffer.byteLength(text, "utf8"),\n' +
  "  directory: () => process.cwd(),\n" +
  "};\n";
const owner: NonNullable<KitConfig["adapters"]>[number] = {
  module: "substrate/adapters/file-access",
  export: "fileAccess",
  capability: "filesystem",
  kind: "external",
  zones: ["substrate"],
  contract: { type: "FileAccess" },
  packages: ["node:fs"],
  globals: ["process", "Buffer"],
};

function inspect(
  files: Readonly<Record<string, string>> = {},
  config: Partial<KitConfig> = {},
) {
  const snapshot = sourceFixture(
    {
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
      [adapter]: adapterSource,
      ...files,
    },
    { adapters: [owner], ...config },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return capabilityCheck(snapshot);
}

const keys = (result: ReturnType<typeof capabilityCheck>, path: string) =>
  result.findings
    .filter((finding) => finding.path === path)
    .map((finding) => `${finding.category}:${finding.debtKey.split(":").slice(0, 2).join(":")}`);

test("a package and the globals an adapter declares are its own: the adapter holds them with no finding", () => {
  const result = inspect();
  expect(result.findings).toEqual([]);
  expect(result.requirements.find((row) => row.path === adapter)?.direct).toEqual(["filesystem"]);
});

test.each([
  ["a core reading", "src/core/readings/read.ts"],
  ["a core composition", "src/core/compositions/read.ts"],
  ["a substrate composition beside the adapter", "src/substrate/compositions/read.ts"],
])("%s importing a package an adapter declares is a finding", (_, path) => {
  const result = inspect({
    [path]:
      'import { readFileSync } from "node:fs";\n' +
      'export function read(path: string): string { return readFileSync(path, "utf8"); }\n',
  });
  expect(keys(result, path)).toContain("placed-violation:R1:package-import");
  expect(keys(result, path).filter((key) => key.startsWith("checker-limit"))).toEqual([]);
});

test("a package row elsewhere in the config does not let the core import a package an adapter declares", () => {
  const path = "src/core/readings/read.ts";
  const result = inspect(
    {
      [path]:
        'import { readFileSync } from "node:fs";\n' +
        'export function read(path: string): string { return readFileSync(path, "utf8"); }\n',
    },
    { packages: [{ name: "node:fs", capabilities: [] }] },
  );
  expect(keys(result, path)).toContain("placed-violation:R1:package-import");
});

test.each([
  ["process", 'export function read(): string { return process.cwd(); }\n'],
  ["Buffer", 'export function read(text: string): number { return Buffer.byteLength(text, "utf8"); }\n'],
])("the core using %s, which an adapter declares, is a finding", (_, source) => {
  const path = "src/core/readings/read.ts";
  expect(keys(inspect({ [path]: source }), path)).toContain("placed-violation:R1:raw-primitive");
});

test("an outer-zone module that imports a package no row declares keeps its limit", () => {
  const path = "src/substrate/compositions/read.ts";
  const result = inspect({
    [path]:
      'import { tmpdir } from "node:os";\n' +
      "export function read(): string { return tmpdir(); }\n",
  });
  expect(keys(result, path)).toContain("checker-limit:R1:external-boundary");
  expect(keys(result, path)).not.toContain("placed-violation:R1:package-import");
});

test("a type-only import of a package an adapter declares grants and costs nothing", () => {
  const path = "src/core/readings/read.ts";
  const result = inspect({
    [path]:
      'import type { Mode } from "node:fs";\n' +
      "export function read(mode: Mode): string { return String(mode); }\n",
  });
  expect(keys(result, path)).toEqual([]);
});

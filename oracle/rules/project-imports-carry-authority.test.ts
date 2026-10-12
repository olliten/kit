import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/primitives/read-snapshot.js";

test("a parenthesized index is outside the directly indexed assertion permission", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-parenthesized-index-"));
  const path = "src/core/readings/parenthesized-index.ts";
  try {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022", strict: true, types: [], noEmit: true },
        include: ["src/**/*.ts"],
      }),
    );
    writeFileSync(
      join(root, path),
      "export function first(values: readonly string[]): string { return (values[0])!; }\n",
    );
    const actual = capabilityCheck(readSnapshot(root, DEFAULT_CONFIG));
    expect(actual.findings.filter((row) => row.path === path)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          debtKey: expect.stringMatching(/^R1:type-escape:/),
          status: "violation",
          blocking: true,
        }),
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project references and path aliases preserve actual local legacy authority", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-project-authority-"));
  const common = {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    lib: ["ES2022"],
    types: [],
    strict: true,
    emitDeclarationOnly: true,
    declaration: true,
    isolatedDeclarations: true,
    composite: true,
    baseUrl: ".",
    paths: { "@shared/*": ["src/shared/*"] },
  };
  const inputs: Readonly<Record<string, string>> = {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.shared.json" }, { path: "./tsconfig.core.json" }],
    }),
    "tsconfig.shared.json": JSON.stringify({
      compilerOptions: common,
      include: ["src/shared/**/*.ts"],
    }),
    "tsconfig.core.json": JSON.stringify({
      compilerOptions: common,
      include: ["src/core/**/*.ts"],
      references: [{ path: "./tsconfig.shared.json" }],
    }),
    "src/shared/clock.ts": "export function now(): number { return Date.now(); }\n",
    "src/shared/public.ts": "export { now } from './clock.js';\n",
    "src/core/readings/instant.ts":
      "import { now } from '@shared/public';\nexport function instant(): number { return now(); }\n",
  };
  try {
    for (const [path, value] of Object.entries(inputs)) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, value);
    }
    const snapshot = readSnapshot(root, DEFAULT_CONFIG);
    const actual = capabilityCheck(snapshot);
    expect(actual.requirements.find((row) => row.path === "src/shared/clock.ts")?.direct).toEqual([
      "clock",
    ]);
    expect(
      actual.requirements.find((row) => row.path === "src/core/readings/instant.ts")?.inherited,
    ).toEqual(["clock"]);
    expect(actual.findings.filter((row) => row.path === "src/core/readings/instant.ts")).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
    );
    expect(actual.findings.filter((row) => row.status === "unresolved")).toEqual([]);
    expect(actual.findings.filter((row) => row.path === "src/shared/clock.ts")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "violation", category: "legacy-debt" }),
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

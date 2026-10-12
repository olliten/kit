import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { readSnapshot } from "../../src/substrate/primitives/read-snapshot.js";

function inspect(
  zone: "core" | "substrate",
  layer: string,
  kind: "produce" | "apply" | "external",
  declaredZone?: "core" | "substrate",
) {
  const root = mkdtempSync(join(tmpdir(), "kit-producer-boundary-"));
  const module = `${zone}/${layer}/operation`;
  const path = `src/${module}.ts`;
  const config: KitConfig = {
    ...DEFAULT_CONFIG,
    adapters: [
      {
        module,
        export: "operation",
        capability:
          kind === "produce" ? "cell.produce" : kind === "apply" ? "cell.apply" : "clock.read",
        kind,
        zones: [declaredZone ?? (kind === "produce" ? "core" : "substrate")],
        ...(kind === "external" ? { primitives: ["clock" as const] } : {}),
      },
    ],
  };
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
    [path]:
      kind === "produce"
        ? "export interface WriteSet { readonly key: string; readonly value: string; }\nexport function operation(key: string, value: string): WriteSet { return { key, value }; }\n"
        : kind === "external"
          ? "export function operation(): number { return Date.now(); }\n"
          : "export function operation(values: Map<string, string>, key: string, value: string): void { values.set(key, value); }\n",
  };
  try {
    for (const [file, source] of Object.entries(inputs)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    const result = capabilityCheck(readSnapshot(root, config));
    return { path, result };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a core composition may produce an actual write set without a primitive constructor wrapper", () => {
  const { path, result } = inspect("core", "compositions", "produce");
  expect(result.requirements.find((row) => row.path === path)?.direct).toEqual(["cell.produce"]);
  expect(result.findings.filter((row) => row.path === path)).toEqual([]);
});

test("a reading cannot gain production authority by being registered as a producer", () => {
  const { path, result } = inspect("core", "readings", "produce");
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: `R1:reading-authority:${path}:cell.produce`,
        status: "violation",
        blocking: true,
      }),
    ]),
  );
});

test("a substrate composition may apply writes directly", () => {
  const { path, result } = inspect("substrate", "compositions", "apply");
  expect(result.requirements.find((row) => row.path === path)?.direct).toEqual(["cell.apply"]);
  expect(result.findings.filter((row) => row.path === path)).toEqual([]);
});

test("a substrate reading cannot apply writes", () => {
  const { path, result } = inspect("substrate", "readings", "apply");
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: `R1:reading-authority:${path}:cell.apply`,
        status: "violation",
        blocking: true,
      }),
    ]),
  );
});

test("an external raw-clock adapter remains confined to primitives", () => {
  const { path, result } = inspect("substrate", "compositions", "external");
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: `R1:adapter-layer:${path}:operation`,
        status: "violation",
        blocking: true,
      }),
    ]),
  );
});

test("a core composition cannot apply writes even when its export is registered", () => {
  const { path, result } = inspect("core", "compositions", "apply");
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: `R1:zone-authority:${path}:cell.apply`,
        status: "violation",
        blocking: true,
      }),
    ]),
  );
});

test("configuration cannot grant core compositions write-application authority", () => {
  const { path, result } = inspect("core", "compositions", "apply", "core");
  expect(result.findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: `R1:zone-authority:${path}:cell.apply`,
        status: "violation",
        blocking: true,
      }),
    ]),
  );
});

import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { constructionCheck } from "../../src/core/readings/construction-check.js";
import { registrationCheck } from "../../src/core/readings/registration-check.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedContracts } from "../substrate/compositions/recorded-contracts.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

// What the write rules decide for one registered operation: the capability its registration grants, and what
// the registration, zone and construction checks find.
function inspect(
  zone: "core" | "substrate",
  layer: string,
  kind: "produce" | "apply" | "external",
  declaredZone?: "core" | "substrate",
) {
  const module = `${zone}/${layer}/operation`;
  const path = `src/${module}.ts`;
  const config: Partial<KitConfig> = {
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
  const files = {
    [path]:
      kind === "produce"
        ? "export interface WriteSet { readonly key: string; readonly value: string; }\nexport function operation(key: string, value: string): WriteSet { return { key, value }; }\n"
        : kind === "external"
          ? "export function operation(): number { return Date.now(); }\n"
          : "export function operation(values: Map<string, string>, key: string, value: string): void { values.set(key, value); }\n",
  };
  const snapshot = projectSnapshot({ ...recordedImports(files, config), ...recordedContracts(files, config) }, config);
  const context = capabilityContext(snapshot, []);
  const graph = authorityGraph(snapshot, context, [], new Set());
  const findings = [
    ...registrationCheck(snapshot, context),
    ...zoneAuthorityCheck(snapshot, context, graph),
    ...constructionCheck(snapshot, []),
  ];
  return { path, result: { direct: [...(graph.direct.get(path) ?? [])].sort(), findings } };
}

test("a core composition may produce an actual write set without a primitive constructor wrapper", () => {
  const { path, result } = inspect("core", "compositions", "produce");
  expect(result.direct).toEqual(["cell.produce"]);
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
  expect(result.direct).toEqual(["cell.apply"]);
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

test("an external raw-clock implementation outside adapters remains forbidden", () => {
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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { compilerCheck } from "../../src/core/readings/compiler-check.js";
import { edgeCheck } from "../../src/core/readings/edge-check.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedEscapes } from "../substrate/compositions/recorded-escapes.js";

test("a parenthesized index is outside the directly indexed assertion permission", () => {
  const path = "src/core/readings/parenthesized-index.ts";
  const snapshot = projectSnapshot(
    recordedEscapes({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", strict: true, types: [], noEmit: true },
        include: ["src/**/*.ts"],
      }),
      [path]: "export function first(values: readonly string[]): string { return (values[0])!; }\n",
    }),
  );
  const findings = compilerCheck(snapshot, capabilityContext(snapshot, []));
  expect(findings.filter((row) => row.path === path)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        debtKey: expect.stringMatching(/^R1:type-escape:/),
        status: "violation",
        blocking: true,
      }),
    ]),
  );
});

// What each file requires through its inputs and imports, and what the compiler, edge and zone checks find in
// it. An app without adapters or entrypoints has no registration, startup, behaviour or construction to check.
function authority(snapshot: Snapshot) {
  const context = capabilityContext(snapshot, []);
  const parts = [accessAuthority(snapshot, context), globalAuthority(snapshot, context), importAuthority(snapshot, context)];
  const edges = edgeCheck(snapshot, context);
  const graph = authorityGraph(snapshot, context, parts, edges.crossZoneFailures);
  return {
    requirements: [...graph.inherited].map(([path, capabilities]) => ({
      path,
      direct: [...(graph.direct.get(path) ?? [])].sort(),
      inherited: [...capabilities].sort(),
    })),
    findings: [
      ...compilerCheck(snapshot, context),
      ...parts.flatMap((part) => part.findings),
      ...edges.findings,
      ...zoneAuthorityCheck(snapshot, context, graph),
    ],
  };
}

// Project references need the whole multi-project read, so this case reads the snapshot end to end.
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
    const snapshot = readSnapshot(root, {
      ...DEFAULT_CONFIG,
      legacyZones: [{ root: "src/shared/", zone: "core" }],
    });
    const actual = authority(snapshot);
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

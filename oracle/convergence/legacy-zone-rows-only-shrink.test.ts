import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { edgeCheck } from "../../src/core/readings/edge-check.js";
import { byDebtKey } from "../../src/core/readings/finding.js";
import { registrationCheck } from "../../src/core/readings/registration-check.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedImports } from "../substrate/compositions/recorded-imports.js";

import { ratchetFindings } from "../../src/core/readings/ratchet.js";

const placed = "src/substrate/compositions/serve.ts";
const legacy = (path: string): string => `export const value: number = ${path.length};\n`;
// The placed composition imports each legacy file, so every legacy edge is reachable from placed code.
const tree = (paths: readonly string[]): Record<string, string> => ({
  [placed]:
    paths
      .map((path, index) => `import { value as v${index} } from "../../${path.slice(4, -3)}.js";\n`)
      .join("") +
    `export function serve(): number { return ${paths.map((_, index) => `v${index}`).join(" + ")}; }\n`,
  ...Object.fromEntries(paths.map((path) => [path, legacy(path)])),
});
const recorded = ["src/accounts.ts", "src/models.ts", "src/readwise/sync.ts"];
const sources = tree(recorded);
const row = (files: readonly string[]): Partial<KitConfig> => ({
  legacyZones: [{ files, zone: "substrate" }],
});

function gate(files: Readonly<Record<string, string>>, config: Partial<KitConfig>, baseline: readonly string[]) {
  // A row's zone and its debt are the registration check's; an edge into a legacy file with no zone is the edge
  // check's limit. No fixture declares an entrypoint, so there are no startups.
  const snapshot = projectSnapshot(recordedImports(files, config), config);
  const context = capabilityContext(snapshot, []);
  const findings = [...registrationCheck(snapshot, context), ...edgeCheck(snapshot, context).findings].sort(byDebtKey);
  const placedPaths = snapshot.files
    .filter((file) => file.type === "source" && file.path.startsWith("src/substrate/"))
    .map((file) => file.path);
  const imports = (snapshot.compiler?.projects ?? []).flatMap((project) =>
    project.imports
      .filter((edge) => !edge.typeOnly && edge.target !== null)
      .map((edge) => ({ from: edge.file, to: edge.target })),
  );
  return { findings, failures: ratchetFindings(findings, baseline, placedPaths, imports) };
}

const debtOf = (findings: readonly { readonly debtKey: string }[]) =>
  findings.map((finding) => finding.debtKey).filter((key) => key.startsWith("R1:legacy-zone"));
const checksOf = (findings: readonly { readonly debtKey: string; readonly path: string }[], path: string) =>
  findings.filter((finding) => finding.path === path).map((finding) => finding.debtKey.split(":")[1]);

test("placed code importing legacy files that have no zone has a migration-zone limit per file", () => {
  const { failures } = gate(sources, {}, []);
  expect(failures.map((finding: { debtKey: string }) => finding.debtKey.split(":")[1])).toEqual([
    "migration-zone",
    "migration-zone",
    "migration-zone",
  ]);
});

test("a row of exact legacy files gives each its zone, and each is debt the baseline records", () => {
  const { findings, failures } = gate(sources, row(recorded), []);
  expect(findings.filter((finding) => finding.debtKey.includes("migration-zone"))).toEqual([]);
  expect(debtOf(findings)).toEqual(recorded.map((path) => `R1:legacy-zone:${path}:substrate`));
  expect(findings.every((finding) => finding.category === "legacy-debt")).toBe(true);
  const baseline = debtOf(findings);
  expect(gate(sources, row(recorded), baseline).failures).toEqual([]);
  expect(failures).toHaveLength(recorded.length);
});

test("a new top-level file beside the row's files gets no zone and stays a limit", () => {
  const baseline = debtOf(gate(sources, row(recorded), []).findings);
  const added = "src/calendar.ts";
  const { findings, failures } = gate(tree([...recorded, added]), row(recorded), baseline);
  expect(checksOf(findings, added)).toEqual([]);
  expect(failures.map((finding: { debtKey: string }) => finding.debtKey)).toEqual([
    `R1:migration-zone:${placed}:${added}`,
  ]);
});

test("removing a file from the row shrinks it with no failure", () => {
  const baseline = debtOf(gate(sources, row(recorded), []).findings);
  const moved = "src/models.ts";
  const kept = recorded.filter((path) => path !== moved);
  const shrunk = gate(tree(kept), row(kept), baseline);
  expect(debtOf(shrunk.findings)).toEqual(baseline.filter((key) => !key.includes(moved)));
  expect(shrunk.failures).toEqual([]);
});

test("adding a file to the row grows it, and the ratchet rejects the growth", () => {
  const baseline = debtOf(gate(sources, row(recorded.slice(0, 2)), []).findings);
  const { failures } = gate(sources, row(recorded), baseline);
  expect(failures.map((finding: { debtKey: string }) => finding.debtKey)).toEqual([
    "R1:legacy-zone:src/readwise/sync.ts:substrate",
  ]);
});

test("a row that names a placed module or a missing file is a finding, never a zone", () => {
  const { findings } = gate(sources, row([...recorded, placed, "src/gone.ts"]), []);
  expect(checksOf(findings, placed)).toEqual(["legacy-zone-row"]);
  expect(checksOf(findings, "src/gone.ts")).toEqual(["legacy-zone-row"]);
});

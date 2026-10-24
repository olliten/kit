import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { hostOf, listedEntries } from "./host-of.js";
import { legacyCodeOf, placementOf, rootOf } from "./placement-of.js";

export interface LegacySizeFinding extends Finding {
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
  readonly category: "legacy-debt";
  readonly statements: number;
  // The statements that do nothing but import, re-export or call a placed module.
  readonly calls: number;
}

// R1, convergence: a legacy module's size is debt like its findings, so the baseline records it and the
// ratchet holds it. Size is counted in statements rather than lines, so reformatting moves neither number.
// A host entry is not legacy, and a placed module is held to the rules instead.
export function legacySize(snapshot: Snapshot): LegacySizeFinding[] {
  const { srcRoot, legacyGrowth } = snapshot.config;
  const entries = listedEntries(hostOf(snapshot.config));
  const fix = `Add at most ${legacyGrowth} statements to this legacy module, each only a call into a placed module; place anything larger first.`;
  return (snapshot.sizes ?? [])
    .filter(
      ({ file }) =>
        (rootOf(file, srcRoot) !== undefined || legacyCodeOf(file, snapshot.config.layout?.legacy)) &&
        !placementOf(file, srcRoot).placed &&
        !entries.includes(file),
    )
    .map(({ file, statements, calls }) => ({
      ...finding("R1", "legacy-size", file, fix),
      status: "violation" as const,
      blocking: true as const,
      limit: "" as const,
      category: "legacy-debt" as const,
      statements,
      calls: calls.filter((target) => target !== file && placementOf(target, srcRoot).placed).length,
    }))
    .sort(byDebtKey);
}

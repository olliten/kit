import type { Snapshot } from "../primitives/snapshot.js";
import { type CapabilityContext, type CapabilityFinding, capabilityFinding, capabilityLimit, placed } from "./capability-context.js";

// Each registration names a resolved export of an adapter-layer module and, when it declares one, a contract
// type the compiler resolves to a named declaration. A files row of a legacy zone lists existing legacy files.
export function registrationCheck(snapshot: Snapshot, context: CapabilityContext): CapabilityFinding[] {
  const findings: CapabilityFinding[] = [];
  const exports = (snapshot.compiler?.projects ?? []).flatMap((project) => project.exports);
  for (const { adapter, path, contracts } of context.adapters) {
    if (!exports.some((symbol) => symbol.file === path && symbol.name === adapter.export))
      findings.push(
        capabilityLimit("adapter-boundary", path, "The declared adapter export is not resolved by the compiler.", adapter.export),
      );
    if (adapter.kind === "external" && placed(snapshot, path)?.layer !== "adapters")
      findings.push(
        capabilityFinding(snapshot, context.startups, "R1", "adapter-layer", path, "Keep raw authority in a narrow capability adapter.", adapter.export),
      );
    if (adapter.contract === undefined) continue;
    if (contracts.length === 0)
      findings.push(capabilityLimit("adapter-contract", path, "The declared operation type is not resolved.", adapter.export));
    if (contracts.some((fact) => fact.type === null))
      findings.push(
        capabilityLimit(
          "adapter-contract",
          path,
          "Anonymous or wrapped operation types have no supported canonical identity.",
          adapter.export,
        ),
      );
  }
  // A files row zones only what it lists, and each listed file is debt, so the baseline records the row's set:
  // dropping a file shrinks it, and a file added to it is new debt the ratchet rejects.
  for (const row of snapshot.config.legacyZones ?? [])
    if ("files" in row)
      for (const path of row.files)
        findings.push(
          context.files.includes(path) && placed(snapshot, path) === null
            ? capabilityFinding(snapshot, context.startups, "R1", "legacy-zone", path, "Place this module, then remove it from its legacy zone row.", row.zone)
            : capabilityFinding(snapshot, context.startups, "R1", "legacy-zone-row", path, "List only existing legacy source files in a legacy zone row.", row.zone),
        );
  return findings;
}

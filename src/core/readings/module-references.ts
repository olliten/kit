import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf } from "./placement-of.js";

// A placed module exists to keep a promise, so some claim names it. The reverse view, every claim a
// module keeps, is derived from the same names and never written into the module.
export function claimsKeptBy(snapshot: Snapshot): ReadonlyMap<string, readonly { file: string; anchor: string }[]> {
  const identity = (name: string): string => name.toLowerCase().trim();
  const kept = new Map<string, { file: string; anchor: string }[]>();
  for (const claim of snapshot.claims ?? [])
    for (const term of claim.terms ?? [])
      kept.set(identity(term), [...(kept.get(identity(term)) ?? []), { file: claim.file, anchor: claim.anchor }]);
  return kept;
}

export function moduleReferences(snapshot: Snapshot): Finding[] {
  const kept = claimsKeptBy(snapshot);
  const findings: Finding[] = [];
  for (const file of snapshot.files) {
    if (file.type !== "source") continue;
    const at = placementOf(file.path, snapshot.config.srcRoot);
    if (!at.placed) continue;
    const name = at.artifact.split("/").at(-1) ?? "";
    const named = (term: string): boolean => kept.has(term.toLowerCase());
    const plural = snapshot.config.plurals.some(
      (suffix) => name.endsWith(suffix) && named(name.slice(0, -suffix.length)),
    );
    if (!named(name) && !plural)
      findings.push(
        finding(
          "R4",
          "unreferenced-module",
          at.artifact,
          `Name {{${name}}} in each claim this module keeps, or delete the module if it keeps none.`,
        ),
      );
  }
  return findings.sort(byDebtKey);
}

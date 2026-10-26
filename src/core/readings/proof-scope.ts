import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf } from "./placement-of.js";
import { claimReach, moduleHomes } from "./proof-reach.js";

export interface ProofScopeFinding extends Finding {
  readonly category: "legacy-debt";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
}

// A claim's names should be exactly what its proof uses, so a placed module its tests reach without the claim
// naming it is debt. Modules of only types and the oracle's own helpers need no name, and a named composition
// covers what it imports. The debt is ratcheted rather than a violation: a too-wide proof is imprecise
// evidence, not broken architecture, and it may only shrink.
export function proofScope(snapshot: Snapshot): ProofScopeFinding[] {
  const { srcRoot, layerNames, oracleRoot } = snapshot.config;
  const homes = moduleHomes(snapshot);
  const reached = claimReach(snapshot);
  const facts = new Set(
    (snapshot.compiler?.projects ?? []).flatMap((project) =>
      (project.termFacts?.sources ?? []).filter((source) => source.factOnly).map((source) => source.file),
    ),
  );
  const edges = new Map<string, string[]>();
  for (const { from, to } of snapshot.imports) edges.set(from, [...(edges.get(from) ?? []), to]);
  const composed = (module: string): string[] => {
    const seen = new Set([module]);
    const pending = [module];
    for (let next = pending.pop(); next !== undefined; next = pending.pop())
      for (const target of edges.get(next) ?? [])
        if (!seen.has(target)) {
          seen.add(target);
          pending.push(target);
        }
    return [...seen];
  };
  const findings = new Map<string, ProofScopeFinding>();
  for (const claim of snapshot.claims ?? []) {
    const files = reached.get(`${claim.file}:${claim.anchor}`)?.files;
    if (files === undefined) continue;
    const named = new Set<string>();
    for (const module of (claim.terms ?? []).flatMap((term) => homes.get(term.toLowerCase().trim()) ?? [])) {
      const at = placementOf(module, srcRoot, layerNames);
      for (const covered of at.placed && at.layer === "compositions" ? composed(module) : [module]) named.add(covered);
    }
    for (const path of files) {
      if (named.has(path) || facts.has(path) || path.startsWith(`${oracleRoot}/`)) continue;
      if (!placementOf(path, srcRoot, layerNames).placed) continue;
      const item: ProofScopeFinding = {
        ...finding(
          "R4",
          "proof-scope",
          claim.file,
          `This claim's tests reach ${path} without naming it: narrow the test to what the claim keeps, or name the module if the claim depends on it.`,
          `${claim.anchor}:${path}`,
        ),
        category: "legacy-debt",
        status: "violation",
        blocking: true,
        limit: "",
      };
      findings.set(item.debtKey, item);
    }
  }
  return [...findings.values()].sort(byDebtKey);
}

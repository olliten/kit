import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { claimReach, moduleHomes } from "./proof-reach.js";

// Two claims that share no code should not share a file, or agents working on them collide for nothing. So
// when the claims naming a module fall into groups whose tests use disjoint declarations of it, the module is
// several modules. A module of only types links no claims, and a test that can't be followed precisely into a
// module uses all of it.
export function claimCohesion(snapshot: Snapshot): Finding[] {
  const homes = moduleHomes(snapshot);
  const reached = claimReach(snapshot);
  const facts = new Set(
    (snapshot.compiler?.projects ?? []).flatMap((project) =>
      (project.termFacts?.sources ?? []).filter((source) => source.factOnly).map((source) => source.file),
    ),
  );
  const claimsOf = new Map<string, { anchor: string; uses: Set<string> | "all" }[]>();
  for (const claim of snapshot.claims ?? []) {
    const reach = reached.get(`${claim.file}:${claim.anchor}`);
    if (reach === undefined) continue;
    for (const module of new Set((claim.terms ?? []).flatMap((term) => homes.get(term.toLowerCase().trim()) ?? []))) {
      if (facts.has(module) || !reach.files.has(module)) continue;
      const uses = reach.whole.has(module)
        ? ("all" as const)
        : new Set([...reach.declarations].filter((declaration) => declaration.startsWith(`${module}:`)));
      if (uses !== "all" && uses.size === 0) continue;
      claimsOf.set(module, [...(claimsOf.get(module) ?? []), { anchor: claim.anchor, uses }]);
    }
  }
  const findings: Finding[] = [];
  for (const [module, claims] of claimsOf) {
    const group = claims.map((_, index) => index);
    const root = (index: number): number => {
      let at = index;
      while (group[at] !== at) at = group[at] ?? at;
      return at;
    };
    claims.forEach((one, i) =>
      claims.forEach((other, j) => {
        if (
          j > i &&
          (one.uses === "all" ||
            other.uses === "all" ||
            [...one.uses].some((declaration) => other.uses !== "all" && other.uses.has(declaration)))
        )
          group[root(j)] = root(i);
      }),
    );
    const groups = new Map<number, string[]>();
    claims.forEach((claim, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), claim.anchor]));
    if (groups.size < 2) continue;
    const described = [...groups.values()].map((anchors) => `{${[...new Set(anchors)].sort().join(", ")}}`).sort();
    findings.push(
      finding(
        "R4",
        "claim-cohesion",
        module,
        `The claims ${described.join(" and ")} use separate parts of this module: split it so each group has its own.`,
      ),
    );
  }
  return findings.sort(byDebtKey);
}

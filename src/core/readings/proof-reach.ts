import type { Snapshot } from "../primitives/snapshot.js";
import { proofOf } from "./claim-proof-binder.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf } from "./placement-of.js";

// A claim's names are what a reader trusts about which modules keep it, so its tests must reach each one.
// Variants prove parts of a claim, so the tests reach the named modules together, not each alone. A test
// reaches what its code uses, as the compiler follows it into helpers and modules, everything a file it can't
// follow precisely imports, and the modules of only types that code is written in; a test no project compiles
// reaches everything its imports do.
export function proofReach(snapshot: Snapshot): Finding[] {
  const { oracleRoot, specRoot, srcRoot, plurals } = snapshot.config;
  const edges = new Map<string, string[]>();
  for (const { from, to } of snapshot.imports) edges.set(from, [...(edges.get(from) ?? []), to]);
  const uses = new Map<string, { reached: Set<string>; whole: Set<string> }>();
  for (const project of snapshot.compiler?.projects ?? [])
    for (const { file, reached, whole } of project.proofs ?? []) {
      const known = uses.get(file) ?? { reached: new Set<string>(), whole: new Set<string>() };
      for (const path of reached) known.reached.add(path);
      for (const path of whole) known.whole.add(path);
      uses.set(file, known);
    }
  const facts = new Set(
    (snapshot.compiler?.projects ?? []).flatMap((project) =>
      (project.termFacts?.sources ?? []).filter((source) => source.factOnly).map((source) => source.file),
    ),
  );
  const reach = (test: string): Set<string> => {
    const used = uses.get(test);
    const seen = new Set(used === undefined ? [test] : [...used.reached, ...used.whole]);
    const follow = (pending: string[], only?: ReadonlySet<string>): void => {
      for (let next = pending.pop(); next !== undefined; next = pending.pop())
        for (const target of edges.get(next) ?? [])
          if (!seen.has(target) && (only === undefined || only.has(target))) {
            seen.add(target);
            pending.push(target);
          }
    };
    follow(used === undefined ? [test] : [...used.whole]);
    // A module of only types has no code to run: the code a test uses reaches the types it is written in.
    follow([...seen], facts);
    return seen;
  };
  const homes = new Map<string, string[]>();
  for (const file of snapshot.files) {
    if (file.type !== "source") continue;
    const at = placementOf(file.path, srcRoot);
    if (!at.placed) continue;
    const names = [
      at.name,
      ...plurals.filter((suffix) => at.name.endsWith(suffix)).map((suffix) => at.name.slice(0, -suffix.length)),
    ];
    for (const name of names) homes.set(name, [...(homes.get(name) ?? []), file.path]);
  }
  const reached = new Map<string, Set<string>>();
  for (const file of snapshot.files) {
    if (file.type !== "test") continue;
    const proof = proofOf(file.path, oracleRoot);
    if (proof === null) continue;
    const home = `${specRoot}/${proof.topic}.md:${proof.anchor}`;
    reached.set(home, new Set([...(reached.get(home) ?? []), ...reach(file.path)]));
  }
  const findings: Finding[] = [];
  for (const claim of snapshot.claims ?? []) {
    const files = reached.get(`${claim.file}:${claim.anchor}`);
    if (files === undefined) continue;
    for (const term of claim.terms ?? []) {
      const modules = homes.get(term.toLowerCase().trim()) ?? [];
      if (modules.length === 0 || modules.some((module) => files.has(module))) continue;
      findings.push(
        finding(
          "R4",
          "unreached-module",
          claim.file,
          `Exercise {{${term}}} from a test of this claim, or stop naming it if the claim doesn't depend on it.`,
          `${claim.anchor}:${term}`,
        ),
      );
    }
  }
  return findings.sort(byDebtKey);
}

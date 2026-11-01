import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { legacyCodeOf, placementOf, proofOf, rootOf } from "./placement-of.js";
import { claimReach, moduleHomes } from "./proof-reach.js";

export interface ProofScopeFinding extends Finding {
  readonly category: "legacy-debt";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
}

// A claim's names should be exactly what its proof uses, so a placed module its tests reach without the claim
// naming it is debt. Only modules of only types need no name: a placed oracle module is named like any other.
// A named composition covers what it imports, and so does any named module under the proof root, since a Proof
// name is about the harness, not the design. The debt is ratcheted rather than a violation: a too-wide proof
// is imprecise evidence, not broken architecture, and it may only shrink. Unplaced code the check counts as debt,
// by its location or its size, carries its own reach: a test's imports stop at it, so what the test reaches only
// through it is not the test's, while what it reaches directly, or through placed code, still is.
export function proofScope(snapshot: Snapshot): ProofScopeFinding[] {
  const { srcRoot, layerNames, oracleRoot, specRoot, layout, exceptions = [] } = snapshot.config;
  const held = new Set(snapshot.files.map((file) => file.path));
  const isDebt = (path: string): boolean =>
    !placementOf(path, srcRoot, layerNames).placed &&
    !exceptions.includes(path) &&
    (rootOf(path, srcRoot) !== undefined || legacyCodeOf(path, layout?.legacy) || (layout !== undefined && held.has(path)));
  const homes = moduleHomes(snapshot);
  const reached = claimReach(snapshot);
  const facts = new Set(
    (snapshot.compiler?.projects ?? []).flatMap((project) =>
      (project.termFacts?.sources ?? []).filter((source) => source.factOnly).map((source) => source.file),
    ),
  );
  const edges = new Map<string, string[]>();
  for (const { from, to } of snapshot.imports) edges.set(from, [...(edges.get(from) ?? []), to]);
  const closures = new Map<string, string[]>();
  const composed = (module: string): string[] => {
    const known = closures.get(module);
    if (known !== undefined) return known;
    const seen = new Set([module]);
    const pending = [module];
    for (let next = pending.pop(); next !== undefined; next = pending.pop())
      for (const target of edges.get(next) ?? [])
        if (!seen.has(target)) {
          seen.add(target);
          pending.push(target);
        }
    closures.set(module, [...seen]);
    return [...seen];
  };
  // Per claim, what its tests reach only through unplaced debt: the closure of each such module they come to,
  // less what they reach by imports that never enter one.
  const throughDebt = new Map<string, { readonly covered: Set<string>; readonly own: Set<string> }>();
  for (const file of snapshot.files) {
    const proof = file.type === "test" ? proofOf(file.path, oracleRoot) : null;
    if (proof === null) continue;
    const key = `${specRoot}/${proof.topic}.md:${proof.anchor}`;
    const known = throughDebt.get(key) ?? { covered: new Set<string>(), own: new Set<string>() };
    const own = new Set([file.path]);
    const entered = new Set<string>();
    const pending = [file.path];
    for (let next = pending.pop(); next !== undefined; next = pending.pop())
      for (const target of edges.get(next) ?? []) {
        if (isDebt(target)) entered.add(target);
        else if (!own.has(target)) {
          own.add(target);
          pending.push(target);
        }
      }
    for (const path of own) known.own.add(path);
    for (const debt of entered) for (const path of composed(debt)) known.covered.add(path);
    throughDebt.set(key, known);
  }
  const findings = new Map<string, ProofScopeFinding>();
  for (const claim of snapshot.claims ?? []) {
    const files = reached.get(`${claim.file}:${claim.anchor}`)?.files;
    if (files === undefined) continue;
    const named = new Set<string>();
    for (const module of (claim.terms ?? []).flatMap((term) => homes.get(term.toLowerCase().trim()) ?? [])) {
      const at = placementOf(module, srcRoot, layerNames);
      const composes = at.placed && (at.layer === "compositions" || module.startsWith(`${oracleRoot}/`));
      for (const covered of composes ? composed(module) : [module]) named.add(covered);
    }
    const debt = throughDebt.get(`${claim.file}:${claim.anchor}`);
    for (const path of files) {
      if (named.has(path) || facts.has(path)) continue;
      if (debt !== undefined && debt.covered.has(path) && !debt.own.has(path)) continue;
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

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
  const used = recordedUses(snapshot);
  const throughDebt = new Map<string, { readonly covered: Set<string>; readonly own: Set<string> }>();
  for (const file of snapshot.files) {
    const proof = file.type === "test" ? proofOf(file.path, oracleRoot) : null;
    if (proof === null) continue;
    const key = `${specRoot}/${proof.topic}.md:${proof.anchor}`;
    const known = throughDebt.get(key) ?? { covered: new Set<string>(), own: new Set<string>() };
    const entered = new Set<string>();
    for (const path of closureOf(file.path, (from) => edges.get(from) ?? [], isDebt, entered)) known.own.add(path);
    // A test owns what its code uses without passing through debt, at its reach's precision: the uses the
    // compiler followed, and what a file it charges whole imports. Without recorded uses, its imports.
    const uses = used.get(file.path);
    if (uses !== undefined) {
      known.own.clear();
      const next = (from: string): readonly string[] => [
        ...(uses.next.get(from) ?? []),
        ...(uses.whole.has(from) ? (edges.get(from) ?? []) : []),
      ];
      for (const path of closureOf(file.path, next, isDebt, new Set())) known.own.add(path);
    }
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

/** What `start` reaches along `next` without entering a module `stops` holds; each stop it meets is added to
 *  `met`. */
function closureOf(
  start: string,
  next: (from: string) => readonly string[],
  stops: (path: string) => boolean,
  met: Set<string>,
): Set<string> {
  const seen = new Set([start]);
  const pending = [start];
  for (let from = pending.pop(); from !== undefined; from = pending.pop())
    for (const target of next(from)) {
      if (stops(target)) met.add(target);
      else if (!seen.has(target)) {
        seen.add(target);
        pending.push(target);
      }
    }
  return seen;
}

/** Each test's recorded uses, as the compiler followed them: which files its code leads to from each file, and
 *  the files it charges whole. Tests without recorded uses are absent. */
function recordedUses(
  snapshot: Snapshot,
): Map<string, { readonly next: Map<string, string[]>; readonly whole: Set<string> }> {
  const out = new Map<string, { readonly next: Map<string, string[]>; readonly whole: Set<string> }>();
  for (const project of snapshot.compiler?.projects ?? [])
    for (const { file, uses, whole } of project.proofs ?? []) {
      if (uses === undefined) continue;
      const known = out.get(file) ?? { next: new Map<string, string[]>(), whole: new Set<string>() };
      for (const { from, to } of uses) known.next.set(from, [...(known.next.get(from) ?? []), to]);
      for (const path of whole) known.whole.add(path);
      out.set(file, known);
    }
  return out;
}

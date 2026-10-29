import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf, proofOf } from "./placement-of.js";

// What the tests of each claim reach, keyed by the claim's topic file and anchor: the files, the top-level
// declarations of other files whose code they use, and the files they can't follow precisely, which count as
// using every declaration. A test reaches what its code uses, as the compiler follows it into helpers and
// modules, everything a file it can't follow precisely imports, and the modules of only types that code is
// written in; a test no project compiles reaches everything its imports do. Variants prove parts of a claim,
// so their reach is merged.
export interface ClaimReach {
  readonly files: ReadonlySet<string>;
  readonly declarations: ReadonlySet<string>;
  readonly whole: ReadonlySet<string>;
}

type Uses = { reached: Set<string>; whole: Set<string>; declarations: Set<string> };

function testUses(snapshot: Snapshot): { uses: Map<string, Uses>; reach: (test: string) => Set<string> } {
  const edges = new Map<string, string[]>();
  for (const { from, to } of snapshot.imports) edges.set(from, [...(edges.get(from) ?? []), to]);
  const uses = new Map<string, Uses>();
  for (const project of snapshot.compiler?.projects ?? [])
    for (const { file, reached, whole, declarations = [] } of project.proofs ?? []) {
      const known = uses.get(file) ?? { reached: new Set<string>(), whole: new Set<string>(), declarations: new Set<string>() };
      for (const path of reached) known.reached.add(path);
      for (const path of whole) known.whole.add(path);
      for (const declaration of declarations) known.declarations.add(`${declaration.file}:${declaration.name}`);
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
  return { uses, reach };
}

// The files one test reaches, by the rule a claim's reach merges: what anything else recorded about the test,
// such as what it ran, can depend on.
export function testReachOf(snapshot: Snapshot): (test: string) => ReadonlySet<string> {
  return testUses(snapshot).reach;
}

export function claimReach(snapshot: Snapshot): Map<string, ClaimReach> {
  const { oracleRoot, specRoot } = snapshot.config;
  const { uses, reach } = testUses(snapshot);
  const claims = new Map<string, { files: Set<string>; declarations: Set<string>; whole: Set<string> }>();
  for (const file of snapshot.files) {
    if (file.type !== "test") continue;
    const proof = proofOf(file.path, oracleRoot);
    if (proof === null) continue;
    const key = `${specRoot}/${proof.topic}.md:${proof.anchor}`;
    const merged = claims.get(key) ?? { files: new Set<string>(), declarations: new Set<string>(), whole: new Set<string>() };
    const files = reach(file.path);
    const used = uses.get(file.path);
    for (const path of files) merged.files.add(path);
    for (const declaration of used?.declarations ?? []) merged.declarations.add(declaration);
    // What a test reaches other than through the code it follows, it may use all of.
    for (const path of files) if (used === undefined || !used.reached.has(path)) merged.whole.add(path);
    claims.set(key, merged);
  }
  return claims;
}

// The placed modules a claim's term names: the module of that name, or of that name without a plural suffix.
export function moduleHomes(snapshot: Snapshot): Map<string, string[]> {
  const { srcRoot, plurals } = snapshot.config;
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
  return homes;
}

// A claim's names are what a reader trusts about which modules keep it, so its tests must reach each one.
export function proofReach(snapshot: Snapshot): Finding[] {
  const homes = moduleHomes(snapshot);
  const reached = claimReach(snapshot);
  const findings: Finding[] = [];
  for (const claim of snapshot.claims ?? []) {
    const files = reached.get(`${claim.file}:${claim.anchor}`)?.files;
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

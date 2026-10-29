import type { CompilerFacts } from "../primitives/compiler-facts.js";
import type { Runs } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { placementOf, proofOf } from "./placement-of.js";
import { moduleHomes } from "./proof-reach.js";

type NamedFunction = NonNullable<CompilerFacts["projects"][number]["functions"]>[number];

// What each claim's tests ran of each placed module: the module's named functions, the claims that name it,
// and for each claim whose tests ran any of it, the ids of the functions they ran. A claim is its topic file
// and anchor.
export interface ModuleRuns {
  readonly module: string;
  readonly functions: readonly NamedFunction[];
  readonly naming: ReadonlySet<string>;
  readonly ran: ReadonlyMap<string, ReadonlySet<string>>;
}

export function claimRuns(snapshot: Snapshot, runs: Runs): ModuleRuns[] {
  const { srcRoot, layerNames, oracleRoot, specRoot } = snapshot.config;
  const homes = moduleHomes(snapshot);
  const naming = new Map<string, Set<string>>();
  for (const claim of snapshot.claims ?? [])
    for (const module of (claim.terms ?? []).flatMap((term) => homes.get(term.toLowerCase().trim()) ?? []))
      naming.set(module, new Set([...(naming.get(module) ?? []), `${claim.file}:${claim.anchor}`]));
  const functions = new Map<string, NamedFunction[]>();
  for (const fact of (snapshot.compiler?.projects ?? []).flatMap((project) => project.functions ?? []))
    if (!(functions.get(fact.file) ?? []).some((known) => known.id === fact.id))
      functions.set(fact.file, [...(functions.get(fact.file) ?? []), fact]);
  return snapshot.files
    .filter((file) => file.type === "source" && placementOf(file.path, srcRoot, layerNames).placed)
    .map(({ path: module }) => {
      const own = functions.get(module) ?? [];
      const ran = new Map<string, Set<string>>();
      for (const [test, modules] of Object.entries(runs.tests)) {
        const proof = proofOf(test, oracleRoot);
        const names = new Set(modules[module] ?? []);
        if (proof === null || names.size === 0) continue;
        const claim = `${specRoot}/${proof.topic}.md:${proof.anchor}`;
        const ids = ran.get(claim) ?? new Set<string>();
        for (const fact of own) if (names.has(`${fact.name}@${fact.line}`)) ids.add(fact.id);
        ran.set(claim, ids);
      }
      return { module, functions: own, naming: naming.get(module) ?? new Set<string>(), ran };
    });
}

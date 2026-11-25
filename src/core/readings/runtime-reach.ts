import type { Runs } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { proofOf } from "./placement-of.js";

export interface RuntimeReach {
  // Each claim, by topic file and anchor: the modules its tests ran a named function of in a complete context.
  readonly reached: ReadonlyMap<string, ReadonlySet<string>>;
  // The claims a test of which records runs but has none kept yet, so what running would reach is not known.
  readonly waiting: ReadonlySet<string>;
}

// Reach by running is use, as reach by following is: an independent proof or a journey, in Node or in a page,
// reaches what it ran. A run in an incomplete context may be another's, so it reaches nothing.
export function runtimeReach(snapshot: Snapshot, runs: Runs | undefined): RuntimeReach {
  const { oracleRoot, specRoot } = snapshot.config;
  const reached = new Map<string, Set<string>>();
  const waiting = new Set<string>();
  if (runs === undefined) return { reached, waiting };
  const pending = new Set(runs.waiting ?? []);
  for (const file of snapshot.files) {
    if (file.type !== "test") continue;
    const proof = proofOf(file.path, oracleRoot);
    if (proof === null) continue;
    const claim = `${specRoot}/${proof.topic}.md:${proof.anchor}`;
    if (pending.has(file.path)) waiting.add(claim);
    const ran = runs.tests[file.path];
    if (ran === undefined) continue;
    if (runs.contexts?.[file.path]?.complete !== true) continue;
    const modules = reached.get(claim) ?? new Set<string>();
    for (const [module, functions] of Object.entries(ran)) if (functions.length > 0) modules.add(module);
    reached.set(claim, modules);
  }
  return { reached, waiting };
}

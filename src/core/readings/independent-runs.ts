import type { Runs } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { proofOf } from "./placement-of.js";

// Execution credit belongs to an individual proof, before variants of its claim are combined. Runtime
// imports are followed whole because an unused declaration can still load application startup.
export function independentRuns(snapshot: Snapshot, runs: Runs): Runs {
  const projects = snapshot.compiler?.projects ?? [];
  const compiled = new Set(projects.flatMap((project) => [...project.files, ...project.ambientFiles]));
  const edges = [
    ...projects.flatMap((project) =>
      project.imports.flatMap((edge) =>
        edge.typeOnly || edge.target === null ? [] : [{ from: edge.file, to: edge.target }],
      ),
    ),
    ...snapshot.imports.filter((edge) => !compiled.has(edge.from)),
  ];
  const importers = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    const paths = importers.get(to) ?? new Set<string>();
    paths.add(from);
    importers.set(to, paths);
  }
  const dependent = new Set(
    (snapshot.config.exceptions ?? []).filter((path) => proofOf(path, snapshot.config.oracleRoot) === null),
  );
  const pending = [...dependent];
  for (let path = pending.pop(); path !== undefined; path = pending.pop())
    for (const importer of importers.get(path) ?? [])
      if (!dependent.has(importer)) {
        dependent.add(importer);
        pending.push(importer);
      }
  return { tests: Object.fromEntries(Object.entries(runs.tests).filter(([test]) => !dependent.has(test))) };
}

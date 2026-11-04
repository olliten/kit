import type { Runs } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { legacyCodeOf, proofOf, rootOf } from "./placement-of.js";

// Execution credit belongs to an individual proof, before variants of its claim are combined. Runtime
// imports are followed whole because an unused declaration can still load application startup.
export function independentRuns(snapshot: Snapshot, runs: Runs): Runs {
  const original = new Set(snapshot.files.filter((file) =>
    file.type === "test" || (file.type === "source" && (
      rootOf(file.path, snapshot.config.srcRoot) !== undefined ||
      legacyCodeOf(file.path, snapshot.config.layout?.legacy ?? []) || snapshot.config.exceptions?.includes(file.path)
    )),
  ).map((file) => file.path));
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
    snapshot.config.bootstraps ?? (snapshot.config.exceptions ?? []).filter((path) => proofOf(path, snapshot.config.oracleRoot) === null),
  );
  const pending = [...dependent];
  for (let path = pending.pop(); path !== undefined; path = pending.pop())
    for (const importer of importers.get(path) ?? [])
      if (!dependent.has(importer)) {
        dependent.add(importer);
        pending.push(importer);
      }
  const tests = Object.fromEntries(
    Object.entries(runs.tests).filter(([test, modules]) => {
      const context = runs.contexts?.[test];
      return context?.complete === true && context.runtime !== "" && !dependent.has(test) &&
        context.loaded.includes(test) && Object.keys(modules).every((module) => context.loaded.includes(module)) &&
        !context.loaded.some((path) => dependent.has(path) || !original.has(path));
    }),
  );
  return {
    tests,
    contexts: Object.fromEntries(Object.entries(runs.contexts ?? {}).filter(([test]) => Object.hasOwn(tests, test))),
  };
}

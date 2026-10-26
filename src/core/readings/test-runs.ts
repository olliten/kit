import type { KitConfig } from "../primitives/default-config.js";
import type { SnapshotFile } from "../primitives/file.js";
import type { Runs } from "../primitives/runs.js";
import { coverageReport } from "./coverage-report.js";
import { placementOf } from "./placement-of.js";

// The runs record from each test's coverage reports: the digest of every placed module and proof-root test, and for each
// test the named functions of each placed module it ran, as `name@line`. A report names a file absolutely or
// relative to the app root.
export function testRuns(
  reports: readonly { readonly test: string; readonly texts: readonly string[] }[],
  files: readonly SnapshotFile[],
  root: string,
  { srcRoot, layerNames, oracleRoot }: Pick<KitConfig, "srcRoot" | "layerNames" | "oracleRoot">,
): Runs {
  const covered = files.filter(
    (file) =>
      (file.type === "test" && file.path.startsWith(`${oracleRoot}/`)) ||
      (file.type === "source" && placementOf(file.path, srcRoot, layerNames).placed),
  );
  const placed = new Set(covered.filter((file) => file.type === "source").map((file) => file.path));
  const local = (file: string): string => (file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file);
  const tests: Record<string, Record<string, string[]>> = {};
  for (const { test, texts } of [...reports].sort((a, b) => (a.test < b.test ? -1 : a.test > b.test ? 1 : 0))) {
    const modules: Record<string, Set<string>> = {};
    for (const report of texts.flatMap(coverageReport)) {
      const module = local(report.file);
      if (!placed.has(module)) continue;
      const ran = (modules[module] ??= new Set());
      for (const fn of report.functions) if (fn.count > 0) ran.add(`${fn.name}@${fn.line}`);
    }
    tests[test] = Object.fromEntries(
      Object.entries(modules)
        .filter(([, ran]) => ran.size > 0)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([module, ran]) => [module, [...ran].sort()]),
    );
  }
  return {
    digests: Object.fromEntries(covered.flatMap((file) => (file.digest === undefined ? [] : [[file.path, file.digest]]))),
    tests,
  };
}

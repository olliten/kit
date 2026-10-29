import type { CompilerFacts } from "../primitives/compiler-facts.js";
import type { KitConfig } from "../primitives/default-config.js";
import type { SnapshotFile } from "../primitives/file.js";
import { coverageReport } from "./coverage-report.js";
import { placementOf } from "./placement-of.js";

type NamedFunction = NonNullable<CompilerFacts["projects"][number]["functions"]>[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The named functions raw V8 coverage shows ran in each placed module, as `name@line`. Raw offsets count in the
// code as it ran, so a function counts only where its name and line match a named function of the source:
// code a tool transformed before running it is left to the LCOV report, which maps it back.
function rawRuns(
  text: string,
  local: (file: string) => string,
  texts: ReadonlyMap<string, string>,
  named: ReadonlySet<string>,
): Map<string, Set<string>> {
  const ran = new Map<string, Set<string>>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return ran;
  }
  const results = isRecord(parsed) && Array.isArray(parsed["result"]) ? parsed["result"] : [];
  for (const result of results) {
    const url = isRecord(result) ? result["url"] : undefined;
    const functions = isRecord(result) ? result["functions"] : undefined;
    if (typeof url !== "string" || !url.startsWith("file://") || !Array.isArray(functions)) continue;
    const module = local(decodeURIComponent(new URL(url).pathname));
    const source = texts.get(module);
    if (source === undefined) continue;
    for (const fn of functions) {
      const name = isRecord(fn) ? fn["functionName"] : undefined;
      const ranges = isRecord(fn) ? fn["ranges"] : undefined;
      const first: unknown = Array.isArray(ranges) ? ranges[0] : undefined;
      const start = isRecord(first) ? first["startOffset"] : undefined;
      const count = isRecord(first) ? first["count"] : undefined;
      if (typeof name !== "string" || !name || typeof start !== "number" || typeof count !== "number" || count === 0) continue;
      const key = `${name}@${source.slice(0, start).split("\n").length}`;
      if (named.has(`${module}:${key}`)) ran.set(module, new Set([...(ran.get(module) ?? []), key]));
    }
  }
  return ran;
}

// What each test ran, from its LCOV reports and raw V8 coverage, which also covers processes the test starts: the
// named functions of each placed module it ran, as `name@line`. A report names a file absolutely or relative to
// the app root.
export function testRuns(
  reports: readonly { readonly test: string; readonly lcov: readonly string[]; readonly v8: readonly string[] }[],
  files: readonly SnapshotFile[],
  root: string,
  { srcRoot, layerNames }: Pick<KitConfig, "srcRoot" | "layerNames">,
  functions: readonly NamedFunction[] = [],
  texts: ReadonlyMap<string, string> = new Map(),
): { readonly test: string; readonly ran: Readonly<Record<string, readonly string[]>> }[] {
  const placed = new Set(
    files.filter((file) => file.type === "source" && placementOf(file.path, srcRoot, layerNames).placed).map((file) => file.path),
  );
  const named = new Set(functions.map((fn) => `${fn.file}:${fn.name}@${fn.line}`));
  const local = (file: string): string => (file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file);
  return [...reports]
    .sort((a, b) => (a.test < b.test ? -1 : a.test > b.test ? 1 : 0))
    .map(({ test, lcov, v8 }) => {
      const modules = new Map<string, Set<string>>();
      const add = (module: string, key: string): void => {
        if (placed.has(module)) modules.set(module, new Set([...(modules.get(module) ?? []), key]));
      };
      for (const report of lcov.flatMap(coverageReport))
        for (const fn of report.functions) if (fn.count > 0) add(local(report.file), `${fn.name}@${fn.line}`);
      for (const text of v8) for (const [module, keys] of rawRuns(text, local, texts, named)) for (const key of keys) add(module, key);
      const ran = [...modules].filter(([, keys]) => keys.size > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return { test, ran: Object.fromEntries(ran.map(([module, keys]) => [module, [...keys].sort()])) };
    });
}

import { normalizedPath } from "./config-values.js";

// The known file a relative import names when no compiler project resolves it: the path itself, or the path with a
// TypeScript extension or an index file.
export function relativeImport(from: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const directory = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : ".";
  const base = normalizedPath(`${directory}/${specifier}`);
  const stem = base.replace(/\.(?:js|mjs|ts|mts)$/, "");
  const candidates = [base, `${stem}.ts`, `${stem}.mts`, `${stem}.tsx`, `${base}/index.ts`];
  return candidates.find((candidate) => known.has(candidate));
}

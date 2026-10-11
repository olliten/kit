import { readFileSync, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { DEFAULT_CONFIG, type KitConfig } from "../../core/data/defaultConfig.js";
import type {
  FileType,
  ImportEdge,
  Snapshot,
  SnapshotFile,
  SpecHeading,
} from "../../core/reading/snapshot.js";

// The kit's only effect: read one snapshot of the codebase at `appRoot`. The TypeScript adapter is a
// regex over `from "…"`, `import "…"` and `import("…")`; only relative imports that resolve to a file
// of the snapshot are recorded. Spec headings are Markdown lines `### <zone>/<kind>/<name>`.
const SKIP_DIR = /^(?:node_modules|\..*)$/;
const IMPORT = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const HEADING = /^###\s+`?([\w.-]+\/[\w.-]+\/[\w.-]+)`?\s*$/gm;
const SOURCE = /\.(?:ts|tsx|mts|js|mjs)$/;

export function readSnapshot(appRoot: string, config: KitConfig = DEFAULT_CONFIG): Snapshot {
  const paths = walk(appRoot).map((abs) => relative(appRoot, abs).split(sep).join("/"));
  const files: SnapshotFile[] = paths.sort().map((path) => ({ path, type: typeOf(path, config) }));
  const known = new Set(paths);
  const imports: ImportEdge[] = [];
  const headings: SpecHeading[] = [];
  for (const { path, type } of files) {
    if (type === "other") continue;
    const text = readFileSync(join(appRoot, path), "utf8");
    if (type === "spec") {
      for (const m of text.matchAll(HEADING)) headings.push({ file: path, name: m[1] ?? "" });
      continue;
    }
    const seen = new Set<string>();
    for (const m of text.matchAll(IMPORT)) {
      const to = resolve(path, m[1] ?? "", known);
      if (to !== undefined && !seen.has(to)) {
        seen.add(to);
        imports.push({ from: path, to });
      }
    }
  }
  return { files, imports, headings, config };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIR.test(entry.name) ? [] : walk(abs);
    return entry.isFile() ? [abs] : [];
  });
}

function typeOf(path: string, config: KitConfig): FileType {
  if (path.startsWith(`${config.specRoot}/`) && path.endsWith(".md")) return "spec";
  if (/\.test\.[mc]?[jt]sx?$/.test(path)) return "test";
  return SOURCE.test(path) ? "source" : "other";
}

function resolve(from: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const stem = base.replace(/\.(?:js|mjs|ts|mts)$/, "");
  const candidates = [base, `${stem}.ts`, `${stem}.mts`, `${stem}.tsx`, `${base}/index.ts`];
  return candidates.find((c) => known.has(c));
}

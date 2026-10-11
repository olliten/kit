import { readFileSync, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import ts from "typescript";
import { DEFAULT_CONFIG, type KitConfig } from "../../core/data/default-config.js";
import type {
  ExportedSymbol,
  FileType,
  ImportEdge,
  Snapshot,
  SnapshotComment,
  SnapshotFile,
  SpecHeading,
  SpecProse,
  SpecTerm,
} from "../../core/reading/snapshot.js";

// The kit's only effect: read one snapshot of the codebase at `appRoot`. The TypeScript adapter is a
// regex over `from "…"`, `import "…"` and `import("…")`; only relative imports that resolve to a file
// of the snapshot are recorded. Spec headings are Markdown lines `### <zone>/<kind>/<name>`, optionally
// followed by ` — <description>`. Terms come only from the config's terms file, as lines
// `- **<term>** — <meaning>` optionally ending `Retired: <word>, <word>.`; its headings are sections. A source file's exported symbols are its top-level declarations
// `export [async] function|const|class|type|interface <name>`. A source or test file's comments come from
// the TypeScript parser, so text inside a string or a regular expression is never mistaken for one.
const SKIP_DIR = /^(?:node_modules|\..*)$/;
const IMPORT = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const HEADING = /^###\s+`?([\w.-]+\/[\w.-]+\/[\w.-]+)`?(?:\s+—\s+.*)?\s*$/gm;
const TERM = /^- \*\*([^*]+)\*\* — (.*?)(?:\s*Retired: ([^.]+)\.?)?\s*$/;
const EXPORT =
  /^export\s+(?:async\s+)?(?:function\*?|const|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm;
const SOURCE = /\.(?:ts|tsx|mts|js|mjs)$/;

export function readSnapshot(appRoot: string, config: KitConfig = DEFAULT_CONFIG): Snapshot {
  const paths = walk(appRoot).map((abs) => relative(appRoot, abs).split(sep).join("/"));
  const files: SnapshotFile[] = paths.sort().map((path) => ({ path, type: typeOf(path, config) }));
  const known = new Set(paths);
  const imports: ImportEdge[] = [];
  const headings: SpecHeading[] = [];
  const terms: SpecTerm[] = [];
  const prose: SpecProse[] = [];
  const symbols: ExportedSymbol[] = [];
  const comments: SnapshotComment[] = [];
  for (const { path, type } of files) {
    if (type === "other") continue;
    const text = readFileSync(join(appRoot, path), "utf8");
    if (type === "spec" && path === config.termsFile) {
      const rest = text.split("\n").filter((line, i) => {
        const [, term, meaning = "", words] = TERM.exec(line) ?? [];
        if (term === undefined) return true;
        const retired = words === undefined ? [] : words.split(",").map((w) => w.trim());
        terms.push({ term, meaning, retired, line: i + 1 });
        return false;
      });
      prose.push({ file: path, text: rest.join("\n") });
      continue;
    }
    if (type === "spec") {
      for (const m of text.matchAll(HEADING)) headings.push({ file: path, name: m[1] ?? "" });
      prose.push({ file: path, text });
      continue;
    }
    if (type === "source") {
      for (const m of text.matchAll(EXPORT)) symbols.push({ file: path, name: m[1] ?? "" });
    }
    comments.push(...commentsOf(path, text));
    const seen = new Set<string>();
    for (const m of text.matchAll(IMPORT)) {
      const to = resolve(path, m[1] ?? "", known);
      if (to !== undefined && !seen.has(to)) {
        seen.add(to);
        imports.push({ from: path, to });
      }
    }
  }
  return { files, imports, headings, terms, prose, symbols, comments, config };
}

// Every comment the parser attaches before or after a node, each once, in file order.
function commentsOf(file: string, text: string): SnapshotComment[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const ranges = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    for (const r of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [])
      ranges.set(r.pos, r);
    for (const r of ts.getTrailingCommentRanges(text, node.getEnd()) ?? []) ranges.set(r.pos, r);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const r of ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()) ?? []) {
    ranges.set(r.pos, r);
  }
  return [...ranges.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((r) => ({
      file,
      line: source.getLineAndCharacterOfPosition(r.pos).line + 1,
      text: text.slice(r.pos, r.end),
    }));
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

import { basename, join, posix, relative, sep } from "node:path";
import ts from "typescript";
import type { SnapshotComment } from "../../core/primitives/comment.js";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../core/primitives/default-config.js";
import type { ExportedSymbol } from "../../core/primitives/exported-symbol.js";
import type { FileType, SnapshotFile, SpecProse } from "../../core/primitives/file.js";
import type { ImportEdge } from "../../core/primitives/import.js";
import type { Snapshot } from "../../core/primitives/snapshot.js";
import type { SpecTerm } from "../../core/primitives/term.js";
import { claimInventory } from "../../core/readings/claim-inventory.js";
import { ignoredImport } from "../../core/readings/ignored-import.js";
import { entrypointOf, legacyCodeOf, rootOf } from "../../core/readings/placement-of.js";
import { relativeImport } from "../../core/readings/relative-import.js";
import { semanticReferenceInventory } from "../../core/readings/semantic-references.js";
import { termInventory } from "../../core/readings/term-inventory.js";
import { compilerWorkspace } from "../adapters/compiler.js";
import { type FilesystemRead, filesystem } from "../adapters/filesystem.js";
import { type FactReuse, type Scope, projectFacts } from "./project-facts.js";
import { sourceSize } from "./source-size.js";

// The kit's only effect: read one snapshot of the codebase at `appRoot`. Only imports that resolve to a file
// of the snapshot are recorded. Terms come only from the config's terms file, as lines
// `- **<term>** — <meaning>` optionally ending `Retired: <word>, <word>.`; its headings are sections. A source file's exported symbols are its top-level declarations
// `export [async] function|const|class|type|interface <name>`.
const SKIP_DIR = /^(?:node_modules|\..*)$/;
const IMPORT = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const EXPORT =
  /^export\s+(?:async\s+)?(?:function\*?|const|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm;
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

// Where facts read before are kept, and the Kit that read them.
export interface StoredFacts {
  readonly reuse: FactReuse;
  readonly engine: string;
}

// How many files' facts and tests' reaches one read reused from the store, and how many it computed.
export interface ExtractionReceipt {
  readonly files: { readonly reused: number; readonly computed: number };
  readonly proofs: { readonly reused: number; readonly computed: number };
}

// A snapshot read with no store: every fact computed.
export function readSnapshot(
  appRoot: string,
  config: KitConfig = DEFAULT_CONFIG,
  trace: { readonly filesystem: FilesystemRead[] } = { filesystem: [] },
): Snapshot {
  return readStoredSnapshot(appRoot, config, undefined, trace).snapshot;
}

// Every file read and listing lands in `trace`. An ignored path is neither listed nor read, so an import into
// it is an error, never a lost edge. With a store, each file's facts and each test's reach are reused while the
// key of what they depend on still matches, and the rest is computed and stored.
export function readStoredSnapshot(
  appRoot: string,
  config: KitConfig,
  store: StoredFacts | undefined,
  trace: { readonly filesystem: FilesystemRead[] } = { filesystem: [] },
): { readonly snapshot: Snapshot; readonly receipt: ExtractionReceipt } {
  rootOf("", config.srcRoot);
  const ignored = (path: string): boolean =>
    (config.ignore ?? []).some((root) => path === root || path.startsWith(`${root}/`));
  const paths = walk(appRoot, appRoot, ignored, trace.filesystem).map((abs) =>
    relative(appRoot, abs).split(sep).join("/"),
  );
  const files: SnapshotFile[] = paths.sort().map((path) => ({ path, type: typeOf(path, config) }));
  const known = new Set(paths);
  const imports: ImportEdge[] = [];
  const specifiers: {
    readonly path: string;
    readonly found: readonly { readonly specifier: string; readonly dynamic: boolean }[];
  }[] = [];
  const terms: SpecTerm[] = [];
  const termSyntax: NonNullable<Snapshot["termSyntax"]>[number][] = [];
  const termOrder: NonNullable<Snapshot["termOrder"]>[number][] = [];
  const prose: SpecProse[] = [];
  const symbols: ExportedSymbol[] = [];
  const comments: SnapshotComment[] = [];
  const claims: NonNullable<Snapshot["claims"]>[number][] = [];
  const claimReferences: NonNullable<Snapshot["claimReferences"]>[number][] = [];
  const semanticReferences: NonNullable<Snapshot["semanticReferences"]>[number][] = [];
  const sources = new Map<string, string>();
  const digests = new Map<string, string>();
  for (const { path, type } of files) {
    if (type === "other") continue;
    const text = filesystem.readText(join(appRoot, path), trace.filesystem);
    const read = trace.filesystem[trace.filesystem.length - 1]?.result;
    if (typeof read === "string") digests.set(path, read);
    if (type === "spec") {
      const inventory = semanticReferenceInventory(text);
      semanticReferences.push(
        ...inventory.references.map((reference) => ({ ...reference, file: path })),
      );
    }
    if (type === "spec" && path === config.termsFile) {
      const inventory = termInventory(text);
      terms.push(...inventory.terms);
      termSyntax.push(...inventory.issues);
      termOrder.push(...inventory.order);
      prose.push({ file: path, text: inventory.prose });
      continue;
    }
    if (type === "spec") {
      const inventory = claimInventory(text, {
        anchor: config.anchor,
        legacy: config.legacyAreas?.includes(path) ?? false,
        ...(config.claimSeparator === undefined ? {} : { separator: config.claimSeparator }),
      });
      claims.push(...inventory.declarations.map((claim) => ({ ...claim, file: path })));
      claimReferences.push(...inventory.references.map((claim) => ({ ...claim, file: path })));
      prose.push({ file: path, text });
      continue;
    }
    if (type === "source") {
      for (const m of text.matchAll(EXPORT)) symbols.push({ file: path, name: m[1] ?? "" });
      if (rootOf(path, config.srcRoot) !== undefined || legacyCodeOf(path, config.layout?.legacy))
        sources.set(path, text);
    }
    comments.push(...commentsOf(path, text));
    specifiers.push({
      path,
      found: [...text.matchAll(IMPORT)].map((m) => ({
        specifier: m[1] ?? "",
        dynamic: /^import\s*\(/.test(m[0]),
      })),
    });
  }
  const { facts: compiler, scopes, receipt } = readCompiler(
    appRoot,
    paths,
    files.map((file) => {
      const digest = digests.get(file.path);
      return digest === undefined ? file : { ...file, digest };
    }),
    config,
    ignored,
    sources,
    known,
    store,
  );
  for (const { path, found } of specifiers) {
    const seen = new Set<string>();
    const scope = scopeOf(path, scopes, appRoot);
    for (const { specifier, dynamic } of found) {
      if (specifier.startsWith(".")) {
        const target = posix.normalize(posix.join(posix.dirname(path), specifier));
        if (ignored(target)) throw ignoredImport(path, target);
      }
      const to = scope === undefined && specifier.startsWith(".")
        ? relativeImport(path, specifier, known)
        : aliasTarget(appRoot, path, specifier, dynamic, scope, ignored, known);
      if (to !== undefined && !seen.has(to)) {
        seen.add(to);
        imports.push({ from: path, to });
      }
    }
  }
  const sizes = [...sources].map(
    ([path, text]) => scopeOf(path, scopes, appRoot)?.sizes.get(path) ?? sourceSize(path, text, undefined, appRoot, known),
  );
  const snapshot: Snapshot = {
    files: files.map((file) => {
      const digest = digests.get(file.path);
      return digest === undefined ? file : { ...file, digest };
    }),
    sizes,
    imports,
    terms,
    termSyntax,
    termOrder,
    prose,
    symbols,
    comments,
    config,
    compiler,
    claims,
    claimReferences,
    semanticReferences,
  };
  return { snapshot, receipt };
}

// A file's imports resolve as the compiler resolves them in the project that compiles it: the one whose
// project file is nearest above it, `tsconfig.json` before its siblings. A file no project compiles has no
// compiler resolution, so its non-relative imports reach nothing.
function scopeOf(path: string, scopes: readonly Scope[], appRoot: string): Scope | undefined {
  const absolute = join(appRoot, path);
  const depth = (scope: Scope): number => scope.directory.split("/").length;
  return scopes
    .filter((scope) => scope.compiled.has(absolute) && (scope.directory === "." || path.startsWith(`${scope.directory}/`)))
    .sort(
      (a, b) =>
        depth(b) - depth(a) ||
        Number(basename(b.file) === "tsconfig.json") - Number(basename(a.file) === "tsconfig.json") ||
        a.file.localeCompare(b.file),
    )[0];
}

// A compiled specifier resolves through the compiler's own module resolution, so `paths`, `baseUrl` and
// `extends` mean what they mean to tsc; only a resolution to a file of the snapshot is an edge. A dynamic
// import is always an ECMAScript import; any other takes the module format of the file it is in.
function aliasTarget(
  appRoot: string,
  path: string,
  specifier: string,
  dynamic: boolean,
  scope: Scope | undefined,
  ignored: (path: string) => boolean,
  known: ReadonlySet<string>,
): string | undefined {
  if (scope === undefined) return undefined;
  const containing = join(appRoot, path);
  const mode = dynamic ? ts.ModuleKind.ESNext : scope.compiled.get(containing);
  const resolved = compilerWorkspace.resolve(specifier, containing, scope.options, mode);
  if (resolved === undefined) return undefined;
  const target = relative(appRoot, resolved.resolvedFileName).split(sep).join("/");
  if (target.startsWith("../")) return undefined;
  if (ignored(target)) throw ignoredImport(path, target);
  return known.has(target) ? target : undefined;
}

function readCompiler(
  appRoot: string,
  paths: readonly string[],
  files: readonly SnapshotFile[],
  config: KitConfig,
  ignored: (path: string) => boolean,
  sources: ReadonlyMap<string, string>,
  known: ReadonlySet<string>,
  store: StoredFacts | undefined,
): { readonly facts: CompilerFacts; readonly scopes: readonly Scope[]; readonly receipt: ExtractionReceipt } {
  const workerHost = compilerWorkspace.workerHost();
  const source = new Set(
    files
      .filter(
        (file) => file.type === "source" ||
          (file.type === "test" && entrypointOf(file.path, config.exceptions ?? [], config.oracleRoot)),
      )
      .map((file) => file.path),
  );
  // The visitor asks for a file's local path at every declaration it reads; computing it each time with
  // path.relative cost about a seventh of a cold extraction.
  const localPaths = new Map<string, string>();
  const local = (file: string): string => {
    let path = localPaths.get(file);
    if (path === undefined) {
      path = relative(appRoot, file).split(sep).join("/");
      localPaths.set(file, path);
    }
    return path;
  };
  const digests = new Map<string, string>();
  for (const file of files) if (file.digest !== undefined) digests.set(file.path, file.digest);
  const context = {
    appRoot,
    config,
    engine: store?.engine ?? "",
    source,
    tests: new Set(files.filter((file) => file.type === "test").map((file) => file.path)),
    sources,
    known,
    digests,
    ignored,
    local,
    workerTypes: new Set(workerHost.types),
    workerGlobals: new Set(workerHost.globals),
  };
  const reads = paths
    .filter((path) => /^tsconfig(?:\.[\w-]+)*\.json$/.test(basename(path)))
    .map((file) => projectFacts(context, file, store?.reuse));
  const sum = (pick: (read: (typeof reads)[number]) => { readonly reused: number; readonly computed: number }) => ({
    reused: reads.reduce((total, read) => total + pick(read).reused, 0),
    computed: reads.reduce((total, read) => total + pick(read).computed, 0),
  });
  return {
    facts: { version: ts.version, projects: reads.map((read) => read.project) },
    scopes: reads.map((read) => read.scope),
    receipt: { files: sum((read) => read.files), proofs: sum((read) => read.proofs) },
  };
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

function walk(
  root: string,
  dir: string,
  ignored: (path: string) => boolean,
  trace: FilesystemRead[],
): string[] {
  return filesystem.entries(dir, trace).flatMap((entry) => {
    const abs = join(dir, entry.name);
    if (ignored(relative(root, abs).split(sep).join("/"))) return [];
    if (entry.directory) return SKIP_DIR.test(entry.name) ? [] : walk(root, abs, ignored, trace);
    return entry.file ? [abs] : [];
  });
}

function typeOf(path: string, config: KitConfig): FileType {
  if (path.startsWith(`${config.specRoot}/`) && path.endsWith(".md")) return "spec";
  if (/\.test\.[mc]?[jt]sx?$/.test(path)) return "test";
  return SOURCE.test(path) ? "source" : "other";
}


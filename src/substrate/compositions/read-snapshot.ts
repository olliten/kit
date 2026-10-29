import { basename, join, posix, relative, sep } from "node:path";
import ts from "typescript";
import type { SnapshotComment } from "../../core/primitives/comment.js";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../core/primitives/default-config.js";
import type { ExportedSymbol } from "../../core/primitives/exported-symbol.js";
import type { FileType, SnapshotFile, SourceSize, SpecProse } from "../../core/primitives/file.js";
import type { ImportEdge } from "../../core/primitives/import.js";
import type { Snapshot } from "../../core/primitives/snapshot.js";
import type { SpecTerm } from "../../core/primitives/term.js";
import { claimInventory } from "../../core/readings/claim-inventory.js";
import { ignoredImport } from "../../core/readings/ignored-import.js";
import { entrypointOf, legacyCodeOf, rootOf } from "../../core/readings/placement-of.js";
import { relativeImport } from "../../core/readings/relative-import.js";
import { semanticReferenceInventory } from "../../core/readings/semantic-references.js";
import { termInventory } from "../../core/readings/term-inventory.js";
import { type CompilerRead, compilerWorkspace } from "../adapters/compiler.js";
import { type FilesystemRead, filesystem } from "../adapters/filesystem.js";
import { authorityRecorder } from "./authority-recorder.js";
import { behaviourReading } from "./behaviour-reading.js";
import { contractReading } from "./contract-reading.js";
import { contractRecorder } from "./contract-recorder.js";
import { escapeRecorder } from "./escape-recorder.js";
import { factWalk } from "./fact-walk.js";
import { functionRecorder } from "./function-recorder.js";
import { importRecorder } from "./import-recorder.js";
import { nativeReading } from "./native-reading.js";
import { sourceSize } from "./source-size.js";
import { syntaxReading } from "./syntax-reading.js";
import { termRecorder } from "./term-recorder.js";
import { testReach } from "./test-reach.js";

// The kit's only effect: read one snapshot of the codebase at `appRoot`. Only imports that resolve to a file
// of the snapshot are recorded. Terms come only from the config's terms file, as lines
// `- **<term>** — <meaning>` optionally ending `Retired: <word>, <word>.`; its headings are sections. A source file's exported symbols are its top-level declarations
// `export [async] function|const|class|type|interface <name>`.
const SKIP_DIR = /^(?:node_modules|\..*)$/;
const IMPORT = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const EXPORT =
  /^export\s+(?:async\s+)?(?:function\*?|const|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm;
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

// Every read lands in `trace`, so a cached snapshot can be reused exactly while each read would still return
// the same. An ignored path is neither listed nor read, so an import into it is an error, never a lost edge.
export function readSnapshot(
  appRoot: string,
  config: KitConfig = DEFAULT_CONFIG,
  trace: { readonly filesystem: FilesystemRead[]; readonly compiler: CompilerRead[] } = {
    filesystem: [],
    compiler: [],
  },
): Snapshot {
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
  const { facts: compiler, scopes } = readCompiler(appRoot, paths, files, config, ignored, sources, trace.compiler);
  for (const { path, found } of specifiers) {
    const seen = new Set<string>();
    const scope = scopeOf(path, scopes);
    for (const { specifier, dynamic } of found) {
      if (specifier.startsWith(".")) {
        const target = posix.normalize(posix.join(posix.dirname(path), specifier));
        if (ignored(target)) throw ignoredImport(path, target);
      }
      const to = scope === undefined && specifier.startsWith(".")
        ? relativeImport(path, specifier, known)
        : aliasTarget(appRoot, path, specifier, dynamic, scope, ignored, known, trace.compiler);
      if (to !== undefined && !seen.has(to)) {
        seen.add(to);
        imports.push({ from: path, to });
      }
    }
  }
  const sizes = [...sources].map(([path, text]) =>
    scopeOf(path, scopes)?.sizes.get(path) ?? sourceSize(path, text, undefined, appRoot, known),
  );
  // The runs record is read like any other input, so a cached snapshot is reused only while it is unchanged.
  let runsText: string | null | undefined;
  if (config.runs !== undefined)
    try {
      runsText = filesystem.readText(join(appRoot, config.runs.record), trace.filesystem);
    } catch {
      runsText = null;
    }
  return {
    files: files.map((file) => {
      const digest = digests.get(file.path);
      return digest === undefined ? file : { ...file, digest };
    }),
    ...(runsText === undefined ? {} : { runsText }),
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
}

type Project = CompilerFacts["projects"][number];

// A project's options and plain file facts retain resolution and size without retaining its compiler.
interface Scope {
  readonly directory: string;
  readonly file: string;
  readonly options: ts.CompilerOptions;
  readonly sources: ReadonlyMap<string, ts.ResolutionMode>;
  readonly sizes: ReadonlyMap<string, SourceSize>;
}

// A file's imports resolve as the compiler resolves them in the project that compiles it: the one whose
// project file is nearest above it, `tsconfig.json` before its siblings. A file no project compiles has no
// compiler resolution, so its non-relative imports reach nothing.
function scopeOf(path: string, scopes: readonly Scope[]): Scope | undefined {
  const depth = (scope: Scope): number => scope.directory.split("/").length;
  return scopes
    .filter((scope) => {
      return (
        scope.sources.has(path) &&
        (scope.directory === "." || path.startsWith(`${scope.directory}/`))
      );
    })
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
  trace: CompilerRead[],
): string | undefined {
  if (scope === undefined) return undefined;
  const containing = join(appRoot, path);
  const mode = dynamic
    ? ts.ModuleKind.ESNext
    : scope.sources.get(path);
  const resolved = compilerWorkspace.resolve(specifier, containing, scope.options, trace, mode);
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
  trace: CompilerRead[],
): { readonly facts: CompilerFacts; readonly scopes: readonly Scope[] } {
  const scopes: Scope[] = [];
  const known = new Set(paths);
  const workerHost = compilerWorkspace.workerHost(trace);
  const workerTypes = new Set(workerHost.types);
  const workerGlobals = new Set(workerHost.globals);
  const source = new Set(
    files
      .filter(
        (file) => file.type === "source" ||
          (file.type === "test" && entrypointOf(file.path, config.exceptions ?? [], config.oracleRoot)),
      )
      .map((file) => file.path),
  );
  const tests = new Set(files.filter((file) => file.type === "test").map((file) => file.path));
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
  const projects = paths
    .filter((path) => /^tsconfig(?:\.[\w-]+)*\.json$/.test(basename(path)))
    .map((file): Project => {
      const absolute = join(appRoot, file);
      const { parsed, readError, program } = compilerWorkspace.load(absolute, trace);
      const checker = program.getTypeChecker();
      const ambientTargets = new Map<string, { readonly declarationTarget: string }>(
        checker.getAmbientModules().flatMap((symbol) => {
          const homes = [...new Set((symbol.declarations ?? []).map((node) => local(node.getSourceFile().fileName)))];
          return homes.length === 1 && homes[0] !== undefined
            ? [[symbol.name, { declarationTarget: homes[0] }] as const]
            : [];
        }),
      );
      const importTarget = (specifier: string, containingFile: string): string | null => {
        const resolved = compilerWorkspace.resolve(specifier, containingFile, parsed.options, trace);
        if (resolved === undefined) return null;
        const target = local(resolved.resolvedFileName);
        if (ignored(target)) throw ignoredImport(local(containingFile), target);
        return target;
      };
      const diagnostics = ts
        .sortAndDeduplicateDiagnostics([
          ...(readError === undefined ? [] : [readError]),
          ...parsed.errors,
          ...ts.getPreEmitDiagnostics(program),
          ...program.getDeclarationDiagnostics(),
        ])
        .map((diagnostic): Project["diagnostics"][number] => ({
          file: diagnostic.file === undefined ? null : local(diagnostic.file.fileName),
          code: diagnostic.code,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
          start: diagnostic.start ?? null,
          length: diagnostic.length ?? null,
          category:
            diagnostic.category === ts.DiagnosticCategory.Error
              ? "error"
              : diagnostic.category === ts.DiagnosticCategory.Warning
                ? "warning"
                : diagnostic.category === ts.DiagnosticCategory.Suggestion
                  ? "suggestion"
                  : "message",
        }));
      const scope = { appRoot, config, program, checker, local, source, workerTypes };
      const syntax = syntaxReading(scope);
      const natives = nativeReading(scope);
      const contractTypes = contractReading(scope);
      const behaviour = behaviourReading(scope, natives, contractTypes);
      const importFacts = importRecorder(scope, importTarget, ambientTargets, syntax, contractTypes, behaviour);
      const authorityFacts = authorityRecorder(scope, workerGlobals, syntax, natives, behaviour);
      const contractFacts = contractRecorder(scope, natives, contractTypes, behaviour);
      const escapeFacts = escapeRecorder();
      const termFacts = termRecorder(scope, syntax);
      const functionFacts = functionRecorder();
      factWalk(scope, [escapeFacts, importFacts, contractFacts, authorityFacts, termFacts, functionFacts]);
      // A test reaches what its code uses, followed into helpers and modules as a capture is, so a helper that
      // imports many modules lends a test only the ones the code it calls uses.
      const proofOf = testReach(
        program,
        checker,
        new Set([...source, ...tests]),
        local,
        importTarget,
      );
      const proofs = program
        .getSourceFiles()
        .filter((sf) => !sf.isDeclarationFile && tests.has(local(sf.fileName)))
        .map((sf) => {
          const { reached, whole, declarations } = proofOf(sf);
          // An import for its effect alone runs the module it names.
          const run = sf.statements.flatMap((statement) =>
            ts.isImportDeclaration(statement) &&
            statement.importClause === undefined &&
            ts.isStringLiteral(statement.moduleSpecifier)
              ? [importTarget(statement.moduleSpecifier.text, sf.fileName) ?? []].flat()
              : [],
          );
          return {
            file: local(sf.fileName),
            reached,
            whole: [...new Set([...whole, ...run])].sort(),
            declarations: declarations.filter((declaration) => declaration.file !== local(sf.fileName)),
          };
        });
      const zone = /^tsconfig\.(core|shell|substrate)\.json$/.exec(basename(file))?.[1];
      const compiled = new Map(
        program.getSourceFiles().filter((sf) => !sf.isDeclarationFile).map((sf) =>
          [local(sf.fileName), sf.impliedNodeFormat] as const),
      );
      scopes.push({
        directory: posix.dirname(file),
        file,
        options: parsed.options,
        sources: compiled,
        sizes: new Map([...sources].filter(([path]) => compiled.has(path)).map(([path, text]) =>
          [path, sourceSize(path, text, program, appRoot, known)] as const)),
      });
      return {
        file,
        zone: zone === "core" || zone === "shell" || zone === "substrate" ? zone : null,
        settings: {
          lib:
            parsed.options.lib ??
            (parsed.options.noLib ? [] : [ts.getDefaultLibFileName(parsed.options)]),
          types: parsed.options.types ?? null,
          strict: parsed.options.strict ?? false,
          noImplicitAny: parsed.options.noImplicitAny ?? parsed.options.strict ?? false,
          strictNullChecks: parsed.options.strictNullChecks ?? parsed.options.strict ?? false,
          isolatedDeclarations: parsed.options.isolatedDeclarations ?? false,
        },
        files: program
          .getSourceFiles()
          .filter((sf) => !sf.isDeclarationFile)
          .map((sf) => local(sf.fileName)),
        ambientFiles: program
          .getSourceFiles()
          .filter((sf) => sf.isDeclarationFile)
          .map((sf) => local(sf.fileName)),
        diagnostics,
        imports: importFacts.imports,
        exports: importFacts.exports,
        globals: authorityFacts.globals,
        escapes: escapeFacts.escapes,
        parameters: [...authorityFacts.parameters.values()],
        contracts: contractFacts.contracts,
        accesses: authorityFacts.accesses,
        constructions: contractFacts.constructions,
        proofs,
        termFacts: { sources: termFacts.sources, types: termFacts.types },
        functions: functionFacts.functions,
      };
    });
  return { facts: { version: ts.version, projects }, scopes };
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


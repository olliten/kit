import { basename, dirname, join, posix, resolve } from "node:path";
import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import type { KitConfig } from "../../core/primitives/default-config.js";
import type { FileFacts, StoredProof } from "../../core/primitives/file-facts.js";
import type { SourceSize } from "../../core/primitives/file.js";
import { closureKey, digest, importClosures, projectKey } from "../../core/readings/fact-keys.js";
import { ignoredImport } from "../../core/readings/ignored-import.js";
import { withRoot, withoutRoot } from "../../core/readings/root-token.js";
import { type CompilerRead, compilerWorkspace } from "../adapters/compiler.js";
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

type Project = CompilerFacts["projects"][number];
type Diagnostic = Project["diagnostics"][number];

// What later steps need of a project once its program is released: its options, the files it compiles and
// their module formats, which decide how their non-relative imports resolve, and the sizes of the sources it
// compiles. Holding every project's program until the end held every checker at once.
export interface Scope {
  readonly directory: string;
  readonly file: string;
  readonly options: ts.CompilerOptions;
  readonly compiled: ReadonlyMap<string, ts.ResolutionMode>;
  readonly sizes: ReadonlyMap<string, SourceSize>;
}

// What every project of one app shares while its facts are read.
export interface AppContext {
  readonly appRoot: string;
  readonly config: KitConfig;
  readonly engine: string;
  readonly source: ReadonlySet<string>;
  readonly tests: ReadonlySet<string>;
  readonly sources: ReadonlyMap<string, string>;
  readonly known: ReadonlySet<string>;
  readonly digests: ReadonlyMap<string, string>;
  readonly ignored: (path: string) => boolean;
  readonly local: (file: string) => string;
  readonly workerTypes: ReadonlySet<string>;
  readonly workerGlobals: ReadonlySet<string>;
}

// Where facts read before are kept, by the key of what they depend on.
export interface FactReuse {
  read(kind: string, key: string): string | undefined;
  write(kind: string, key: string, text: string): void;
}

export interface ProjectRead {
  readonly project: Project;
  readonly scope: Scope;
  readonly files: { readonly reused: number; readonly computed: number };
  readonly proofs: { readonly reused: number; readonly computed: number };
}

const declarationDigests = new WeakMap<ts.SourceFile, string>();
const textDigest = (sf: ts.SourceFile): string => {
  const known = declarationDigests.get(sf);
  if (known !== undefined) return known;
  const value = digest(sf.text);
  declarationDigests.set(sf, value);
  return value;
};

const category = (diagnostic: ts.Diagnostic): Diagnostic["category"] =>
  diagnostic.category === ts.DiagnosticCategory.Error
    ? "error"
    : diagnostic.category === ts.DiagnosticCategory.Warning
      ? "warning"
      : diagnostic.category === ts.DiagnosticCategory.Suggestion
        ? "suggestion"
        : "message";

// The module specifiers a file names anywhere: imports, re-exports, `import =`, `import()`, `require()` and
// `import("…")` types.
function specifiersOf(sf: ts.SourceFile): ts.StringLiteralLike[] {
  const found: ts.StringLiteralLike[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) found.push(node.moduleSpecifier);
    } else if (ts.isExternalModuleReference(node) && ts.isStringLiteralLike(node.expression)) found.push(node.expression);
    else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const [first] = node.arguments;
      const loads =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require");
      if (loads && first !== undefined && ts.isStringLiteralLike(first)) found.push(first);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal))
      found.push(node.argument.literal);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// A file that declares globals or ambient modules changes what every file of its program means.
const declaresGlobals = (sf: ts.SourceFile): boolean =>
  !ts.isExternalModule(sf) ||
  sf.statements.some(
    (statement) =>
      ts.isModuleDeclaration(statement) &&
      ((statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0 || ts.isStringLiteral(statement.name)),
  );

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byIdentity = (a: { readonly file: string; readonly name: string }, b: { readonly file: string; readonly name: string }): number =>
  byText(a.file, b.file) || byText(a.name, b.name);

// The compiler lists a type's members and a union's parts in the order it happened to create them, which depends
// on what it checked first. These lists are sets to every check, so they are kept in one order, and a fact reads
// the same whether its file was walked alone or with the whole program.
function canonical(facts: FileFacts): FileFacts {
  return {
    ...facts,
    parameters: facts.parameters.map((parameter) => ({ ...parameter, types: [...parameter.types].sort(byIdentity) })),
    contracts: facts.contracts.map((contract) => ({
      ...contract,
      operations: [...contract.operations].sort(byText),
      ...(contract.ports === undefined ? {} : { ports: [...contract.ports].sort(byIdentity) }),
    })),
    constructions: facts.constructions.map((construction) => ({ ...construction, types: [...construction.types].sort(byIdentity) })),
    termTypes: facts.termTypes.map((type) => ({
      ...type,
      properties: [...type.properties]
        .map((property) => ({ ...property, types: [...property.types].sort(byIdentity) }))
        .sort((a, b) => byText(a.name, b.name)),
    })),
  };
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const order: readonly (readonly [string | number | null, string | number | null])[] = [
    [a.file, b.file],
    [a.start, b.start],
    [a.length, b.length],
    [a.code, b.code],
    [a.message, b.message],
  ];
  for (const [x, y] of order) {
    if (x === y) continue;
    if (x === null) return -1;
    if (y === null) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// One compiler project's facts. Each file's facts and each test's reach are stored under the key of what they
// depend on, so a later read reuses every file and test whose key still matches and walks only the rest; with
// nothing to reuse, every file is walked.
export function projectFacts(context: AppContext, file: string, trace: CompilerRead[], reuse?: FactReuse): ProjectRead {
  const { appRoot, config, source, tests, local, ignored } = context;
  const absolute = join(appRoot, file);
  const { parsed, readError, program } = compilerWorkspace.load(absolute, trace);
  const checker = program.getTypeChecker();
  const programFiles = program.getSourceFiles();
  const own = programFiles.filter((sf) => !sf.isDeclarationFile);
  const compiled = new Map<string, ts.ResolutionMode>();
  for (const sf of own) compiled.set(sf.fileName, sf.impliedNodeFormat);

  const digests = new Map(context.digests);
  for (const sf of own) if (!digests.has(local(sf.fileName))) digests.set(local(sf.fileName), digest(sf.text));
  const edges = new Map<string, string[]>();
  for (const sf of own) {
    const targets = new Set<string>();
    for (const specifier of specifiersOf(sf))
      for (const declaration of checker.getSymbolAtLocation(specifier)?.declarations ?? [])
        if (ts.isSourceFile(declaration) && !declaration.isDeclarationFile) targets.add(local(declaration.fileName));
    for (const reference of sf.referencedFiles) {
      const named = resolve(dirname(sf.fileName), reference.fileName);
      const target = [named, `${named}.ts`, `${named}.d.ts`].map((path) => program.getSourceFile(path)).find((each) => each !== undefined);
      if (target !== undefined && !target.isDeclarationFile) targets.add(local(target.fileName));
    }
    edges.set(local(sf.fileName), [...targets]);
  }
  const walked = programFiles.filter((sf) => source.has(local(sf.fileName)));
  const proofFiles = own.filter((sf) => tests.has(local(sf.fileName)));
  const closures = importClosures(
    [...new Set([...own, ...walked].map((sf) => local(sf.fileName)))],
    edges,
  );
  const adapterFiles = (config.adapters ?? []).flatMap((adapter) =>
    [...closures.keys()].filter((path) => path === adapter.module || path.replace(/\.[^./]+$/, "") === adapter.module),
  );
  const project = projectKey({
    engine: context.engine,
    typescript: ts.version,
    config,
    options: withoutRoot(JSON.stringify(parsed.options), appRoot),
    declarations: programFiles.filter((sf) => sf.isDeclarationFile).map((sf) => [local(sf.fileName), textDigest(sf)]),
    globals: own.filter(declaresGlobals).map((sf) => [local(sf.fileName), digests.get(local(sf.fileName)) ?? ""]),
    adapters: [...new Set(adapterFiles.flatMap((path) => closures.get(path) ?? []))].map((path) => [path, digests.get(path) ?? ""]),
  });
  const roles = new Map<string, string>();
  for (const path of closures.keys()) roles.set(path, source.has(path) ? "source" : tests.has(path) ? "test" : "other");
  const keyOf = (path: string): string => closureKey(project, closures.get(path) ?? [path], digests, roles);

  const stored = <T>(kind: string, key: string): T | undefined => {
    const text = reuse?.read(kind, key);
    if (text === undefined) return undefined;
    try {
      const value: T = JSON.parse(withRoot(text, appRoot));
      return value;
    } catch {
      return undefined;
    }
  };
  const fileKeys = new Map(own.concat(walked.filter((sf) => sf.isDeclarationFile)).map((sf) => [local(sf.fileName), keyOf(local(sf.fileName))]));
  const facts = new Map<string, FileFacts>();
  for (const [path, key] of fileKeys) {
    const found = stored<FileFacts>("facts", key);
    if (found !== undefined) facts.set(path, found);
  }
  const proofs = new Map<string, StoredProof>();
  for (const sf of proofFiles) {
    const found = stored<StoredProof>("proofs", digest(`proof\u0000${fileKeys.get(local(sf.fileName)) ?? ""}`));
    if (found !== undefined) proofs.set(local(sf.fileName), found);
  }
  const projectWide = stored<{ readonly diagnostics: Diagnostic[] }>("project", project);

  const toDiagnostic = (diagnostic: ts.Diagnostic): Diagnostic => ({
    file: diagnostic.file === undefined ? null : local(diagnostic.file.fileName),
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    start: diagnostic.start ?? null,
    length: diagnostic.length ?? null,
    category: category(diagnostic),
  });
  const ambientTargets = new Map<string, { readonly declarationTarget: string }>(
    checker.getAmbientModules().flatMap((symbol) => {
      const homes = [...new Set((symbol.declarations ?? []).map((node) => local(node.getSourceFile().fileName)))];
      return homes.length === 1 && homes[0] !== undefined ? [[symbol.name, { declarationTarget: homes[0] }] as const] : [];
    }),
  );
  const importTarget = (specifier: string, containingFile: string): string | null => {
    const resolved = compilerWorkspace.resolve(specifier, containingFile, parsed.options, trace);
    if (resolved === undefined) return null;
    const target = local(resolved.resolvedFileName);
    if (ignored(target)) throw ignoredImport(local(containingFile), target);
    return target;
  };

  const dirty = new Set([...fileKeys.keys()].filter((path) => !facts.has(path)));
  const computedFiles = dirty.size;
  if (dirty.size > 0) {
    const scope = { appRoot, config, program, checker, local, source, workerTypes: context.workerTypes };
    const syntax = syntaxReading(scope);
    const natives = nativeReading(scope);
    const contractTypes = contractReading(scope);
    const behaviour = behaviourReading(scope, natives, contractTypes);
    const importFacts = importRecorder(scope, importTarget, ambientTargets, syntax, contractTypes, behaviour);
    const authorityFacts = authorityRecorder(scope, context.workerGlobals, syntax, natives, behaviour);
    const contractFacts = contractRecorder(scope, natives, contractTypes, behaviour);
    const escapeFacts = escapeRecorder();
    const termFacts = termRecorder(scope, syntax);
    const functionFacts = functionRecorder();
    factWalk(scope, [escapeFacts, importFacts, contractFacts, authorityFacts, termFacts, functionFacts], dirty);
    const of = <T extends { readonly file: string }>(entries: Iterable<T>, path: string): T[] =>
      [...entries].filter((entry) => entry.file === path);
    for (const path of dirty) {
      const sf = program.getSourceFile(join(appRoot, path));
      const text = context.sources.get(path);
      const read: FileFacts = canonical({
        diagnostics:
          sf === undefined || sf.isDeclarationFile
            ? []
            : [
                ...program.getSyntacticDiagnostics(sf),
                ...program.getSemanticDiagnostics(sf),
                ...program.getDeclarationDiagnostics(sf),
              ].map(toDiagnostic),
        imports: of(importFacts.imports, path),
        exports: of(importFacts.exports, path),
        globals: of(authorityFacts.globals, path),
        escapes: of(escapeFacts.escapes, path),
        parameters: of(authorityFacts.parameters.values(), path),
        contracts: of(contractFacts.contracts, path),
        accesses: of(authorityFacts.accesses, path),
        constructions: of(contractFacts.constructions, path),
        termSources: of(termFacts.sources, path),
        termTypes: of(termFacts.types, path),
        functions: of(functionFacts.functions, path),
        size: text === undefined ? null : sourceSize(path, text, program, appRoot, context.known),
      });
      facts.set(path, read);
      reuse?.write("facts", fileKeys.get(path) ?? "", withoutRoot(JSON.stringify(read), appRoot));
    }
  }

  const dirtyProofs = proofFiles.filter((sf) => !proofs.has(local(sf.fileName)));
  if (dirtyProofs.length > 0) {
    // A test reaches what its code uses, followed into helpers and modules as a capture is, so a helper that
    // imports many modules lends a test only the ones the code it calls uses.
    const proofOf = testReach(checker, new Set([...source, ...tests]), local, importTarget);
    for (const sf of dirtyProofs) {
      const path = local(sf.fileName);
      const { reached, whole, declarations } = proofOf(sf);
      // An import for its effect alone runs the module it names.
      const run = sf.statements.flatMap((statement) =>
        ts.isImportDeclaration(statement) && statement.importClause === undefined && ts.isStringLiteral(statement.moduleSpecifier)
          ? [importTarget(statement.moduleSpecifier.text, sf.fileName) ?? []].flat()
          : [],
      );
      const proof: StoredProof = {
        file: path,
        reached,
        whole: [...new Set([...whole, ...run])].sort(),
        declarations: declarations.filter((declaration) => declaration.file !== path),
      };
      proofs.set(path, proof);
      reuse?.write("proofs", digest(`proof\u0000${fileKeys.get(path) ?? ""}`), withoutRoot(JSON.stringify(proof), appRoot));
    }
  }

  // What belongs to no one file: the config's and options' errors, global errors, and the declaration files'
  // own errors, which depend only on what the project key holds.
  const wide =
    projectWide?.diagnostics ??
    (() => {
      const computed = [
        ...(readError === undefined ? [] : [readError]),
        ...parsed.errors,
        ...program.getConfigFileParsingDiagnostics(),
        ...program.getOptionsDiagnostics(),
        ...program.getGlobalDiagnostics(),
        ...programFiles
          .filter((sf) => sf.isDeclarationFile)
          .flatMap((sf) => [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]),
      ].map(toDiagnostic);
      reuse?.write("project", project, withoutRoot(JSON.stringify({ diagnostics: computed }), appRoot));
      return computed;
    })();
  const diagnostics = [...wide, ...[...facts.values()].flatMap((each) => each.diagnostics)]
    .sort(compareDiagnostics)
    .filter((diagnostic, index, all) => index === 0 || compareDiagnostics(all[index - 1] ?? diagnostic, diagnostic) !== 0);

  const inOrder = walked.flatMap((sf) => {
    const found = facts.get(local(sf.fileName));
    return found === undefined ? [] : [found];
  });
  const sizes = new Map<string, SourceSize>();
  for (const [path, each] of facts) if (each.size !== null && context.sources.has(path)) sizes.set(path, each.size);
  const zone = /^tsconfig\.(core|shell|substrate)\.json$/.exec(basename(file))?.[1];
  return {
    project: {
      file,
      zone: zone === "core" || zone === "shell" || zone === "substrate" ? zone : null,
      settings: {
        lib: parsed.options.lib ?? (parsed.options.noLib ? [] : [ts.getDefaultLibFileName(parsed.options)]),
        types: parsed.options.types ?? null,
        strict: parsed.options.strict ?? false,
        noImplicitAny: parsed.options.noImplicitAny ?? parsed.options.strict ?? false,
        strictNullChecks: parsed.options.strictNullChecks ?? parsed.options.strict ?? false,
        isolatedDeclarations: parsed.options.isolatedDeclarations ?? false,
      },
      files: own.map((sf) => local(sf.fileName)),
      ambientFiles: programFiles.filter((sf) => sf.isDeclarationFile).map((sf) => local(sf.fileName)),
      diagnostics,
      imports: inOrder.flatMap((each) => each.imports),
      exports: inOrder.flatMap((each) => each.exports),
      globals: inOrder.flatMap((each) => each.globals),
      escapes: inOrder.flatMap((each) => each.escapes),
      parameters: inOrder.flatMap((each) => each.parameters),
      contracts: inOrder.flatMap((each) => each.contracts),
      accesses: inOrder.flatMap((each) => each.accesses),
      constructions: inOrder.flatMap((each) => each.constructions),
      proofs: proofFiles.flatMap((sf) => {
        const found = proofs.get(local(sf.fileName));
        return found === undefined ? [] : [found];
      }),
      termFacts: { sources: inOrder.flatMap((each) => each.termSources), types: inOrder.flatMap((each) => each.termTypes) },
      functions: inOrder.flatMap((each) => each.functions),
    },
    scope: { directory: posix.dirname(file), file, options: parsed.options, compiled, sizes },
    files: { reused: fileKeys.size - computedFiles, computed: computedFiles },
    proofs: { reused: proofFiles.length - dirtyProofs.length, computed: dirtyProofs.length },
  };
}


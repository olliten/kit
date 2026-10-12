import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import ts from "typescript";
import { DEFAULT_CONFIG, type KitConfig } from "../../core/primitives/default-config.js";
import { claimInventory } from "../../core/readings/claim-inventory.js";
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
} from "../../core/readings/snapshot.js";

// The kit's only effect: read one snapshot of the codebase at `appRoot`. Only imports that resolve to a file
// of the snapshot are recorded. Spec headings are Markdown lines `### <zone>/<layer>/<name>`, optionally
// followed by ` — <description>`. Terms come only from the config's terms file, as lines
// `- **<term>** — <meaning>` optionally ending `Retired: <word>, <word>.`; its headings are sections. A source file's exported symbols are its top-level declarations
// `export [async] function|const|class|type|interface <name>`.
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
  const claims: NonNullable<Snapshot["claims"]>[number][] = [];
  const claimReferences: NonNullable<Snapshot["claimReferences"]>[number][] = [];
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
      const inventory = claimInventory(text, {
        anchor: config.anchor,
        legacy: config.legacyAreas?.includes(path) ?? false,
        ...(config.claimSeparator === undefined ? {} : { separator: config.claimSeparator }),
      });
      claims.push(...inventory.declarations.map((claim) => ({ ...claim, file: path })));
      claimReferences.push(...inventory.references.map((claim) => ({ ...claim, file: path })));
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
  const compiler = readCompiler(appRoot, paths, files);
  return {
    files,
    imports,
    headings,
    terms,
    prose,
    symbols,
    comments,
    config,
    compiler,
    claims,
    claimReferences,
  };
}

type Compiler = NonNullable<Snapshot["compiler"]>;
type Project = Compiler["projects"][number];

function readCompiler(
  appRoot: string,
  paths: readonly string[],
  files: readonly SnapshotFile[],
): Compiler {
  const source = new Set(files.filter((file) => file.type === "source").map((file) => file.path));
  const local = (file: string): string => relative(appRoot, file).split(sep).join("/");
  const projects = paths
    .filter((path) => /^tsconfig(?:\.[\w-]+)*\.json$/.test(basename(path)))
    .map((file): Project => {
      const absolute = join(appRoot, file);
      const read = ts.readConfigFile(absolute, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        read.config ?? {},
        ts.sys,
        dirname(absolute),
        undefined,
        absolute,
      );
      const host = {
        ...ts.createCompilerHost(parsed.options),
        useSourceOfProjectReferenceRedirect: () => true,
      };
      const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        host,
        ...(parsed.projectReferences === undefined
          ? {}
          : { projectReferences: parsed.projectReferences }),
      });
      const checker = program.getTypeChecker();
      const importTarget = (specifier: string, containingFile: string): string | null => {
        const resolved = ts.resolveModuleName(
          specifier,
          containingFile,
          parsed.options,
          ts.sys,
        ).resolvedModule;
        return resolved === undefined ? null : local(resolved.resolvedFileName);
      };
      const diagnostics = ts
        .sortAndDeduplicateDiagnostics([
          ...(read.error === undefined ? [] : [read.error]),
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
      const imports: Project["imports"][number][] = [];
      const exports: Project["exports"][number][] = [];
      const globals: Project["globals"][number][] = [];
      const escapes: Project["escapes"][number][] = [];
      const parameters: Project["parameters"][number][] = [];
      const contracts: Project["contracts"][number][] = [];
      const accesses: Project["accesses"][number][] = [];
      const constructions: Project["constructions"][number][] = [];
      const connections: Project["connections"][number][] = [];
      const targetOf = (node: ts.Node): ts.Declaration | undefined => {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
          symbol = checker.getAliasedSymbol(symbol);
        return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      };
      const typeFacts = (
        type: ts.Type,
        seen = new Set<ts.Type>(),
      ): {
        callable: boolean;
        accessor: boolean;
        types: { file: string; name: string }[];
      } => {
        if (seen.has(type)) return { callable: false, accessor: false, types: [] };
        seen.add(type);
        const symbol = type.aliasSymbol ?? type.symbol;
        const declaration = symbol?.declarations?.[0];
        const own =
          declaration === undefined
            ? []
            : [{ file: local(declaration.getSourceFile().fileName), name: symbol?.name ?? "" }];
        let children: readonly ts.Type[] = [];
        if (type.isUnionOrIntersection()) children = type.types;
        else if (
          checker.isArrayType(type) ||
          checker.isTupleType(type) ||
          symbol?.name === "ReadonlyArray"
        ) {
          const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
          children = element === undefined ? [] : [element];
        } else if (
          (type.flags & ts.TypeFlags.Object) !== 0 &&
          !symbol?.declarations?.some(
            (node) => ts.isClassDeclaration(node) || ts.isClassExpression(node),
          )
        )
          children = type.getProperties().flatMap((property) => {
            const declaration = property.valueDeclaration ?? property.declarations?.[0];
            return declaration === undefined
              ? []
              : [checker.getTypeOfSymbolAtLocation(property, declaration)];
          });
        const facts = [...children, ...(type.aliasTypeArguments ?? [])].map((child) =>
          typeFacts(child, seen),
        );
        return {
          callable: type.getCallSignatures().length > 0 || facts.some((fact) => fact.callable),
          accessor:
            symbol?.declarations?.some(
              (node) => ts.isClassDeclaration(node) || ts.isClassExpression(node),
            ) === true ||
            type
              .getProperties()
              .some((property) => property.declarations?.some(ts.isGetAccessorDeclaration)) ||
            facts.some((fact) => fact.accessor),
          types: [
            ...new Map(
              [...own, ...facts.flatMap((fact) => fact.types)].map((identity) => [
                `${identity.file}:${identity.name}`,
                identity,
              ]),
            ).values(),
          ],
        };
      };
      const operationsOf = (type: ts.Type): string[] =>
        type
          .getProperties()
          .filter((property) => {
            const declaration = property.valueDeclaration ?? property.declarations?.[0];
            return (
              declaration !== undefined &&
              checker.getTypeOfSymbolAtLocation(property, declaration).getCallSignatures().length >
                0
            );
          })
          .map((property) => property.name);
      const contractIdentity = (type: ts.Type): { file: string; name: string } | null => {
        const symbol = type.aliasSymbol ?? type.symbol;
        const declaration = symbol?.declarations?.[0];
        return declaration !== undefined &&
          (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) &&
          source.has(local(declaration.getSourceFile().fileName))
          ? { file: local(declaration.getSourceFile().fileName), name: symbol?.name ?? "" }
          : null;
      };
      const typeOnlyOf = (node: ts.ImportDeclaration | ts.ExportDeclaration): boolean => {
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause;
          const bindings = clause?.namedBindings;
          return (
            clause?.isTypeOnly === true ||
            (clause?.name === undefined &&
              bindings !== undefined &&
              ts.isNamedImports(bindings) &&
              bindings.elements.length > 0 &&
              bindings.elements.every((element) => element.isTypeOnly))
          );
        }
        return (
          node.isTypeOnly ||
          (node.exportClause !== undefined &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 &&
            node.exportClause.elements.every((element) => element.isTypeOnly))
        );
      };
      const typeNames = (type: ts.Type): { file: string; name: string }[] => {
        const alias = type.aliasSymbol?.declarations?.[0];
        if (alias !== undefined)
          return [
            { file: local(alias.getSourceFile().fileName), name: type.aliasSymbol?.name ?? "" },
          ];
        if (type.isUnionOrIntersection()) return type.types.flatMap(typeNames);
        const symbol = type.aliasSymbol ?? type.symbol;
        const declaration = symbol?.declarations?.[0];
        return declaration === undefined
          ? []
          : [{ file: local(declaration.getSourceFile().fileName), name: symbol?.name ?? "" }];
      };
      const primitiveOf = (
        owner: string | null,
        name: string,
      ): "clock" | "randomness" | "dynamic" | null => {
        if (owner === "Date" && name === "now") return "clock";
        if (owner === "Math" && name === "random") return "randomness";
        return null;
      };
      const rawAccess = (
        node: ts.Expression,
        seen = new Set<ts.Node>(),
      ): "clock" | "randomness" | "dynamic" | null => {
        if (seen.has(node)) return null;
        seen.add(node);
        if (ts.isParenthesizedExpression(node)) return rawAccess(node.expression, seen);
        if (ts.isIdentifier(node)) {
          if (["eval", "Function"].includes(globalName(node) ?? "")) return "dynamic";
          const declaration = targetOf(node);
          if (
            declaration !== undefined &&
            ts.isBindingElement(declaration) &&
            ts.isObjectBindingPattern(declaration.parent) &&
            ts.isVariableDeclaration(declaration.parent.parent) &&
            declaration.parent.parent.initializer !== undefined
          ) {
            const owner = globalName(declaration.parent.parent.initializer);
            if (["Math", "Date", "Reflect"].includes(owner ?? "")) {
              const property = declaration.propertyName ?? declaration.name;
              return ts.isIdentifier(property) || ts.isStringLiteralLike(property)
                ? (primitiveOf(owner, property.text) ?? "dynamic")
                : "dynamic";
            }
          }
          if (
            declaration !== undefined &&
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer !== undefined
          )
            return rawAccess(declaration.initializer, seen);
        }
        if (ts.isPropertyAccessExpression(node)) {
          return primitiveOf(globalName(node.expression), node.name.text);
        }
        return null;
      };
      const globalName = (node: ts.Expression, seen = new Set<ts.Node>()): string | null => {
        if (seen.has(node)) return null;
        seen.add(node);
        if (ts.isParenthesizedExpression(node)) return globalName(node.expression, seen);
        if (!ts.isIdentifier(node)) return null;
        if (
          node.text === "globalThis" &&
          checker.getSymbolAtLocation(node) ===
            checker.resolveName("globalThis", undefined, ts.SymbolFlags.Value, false)
        )
          return "globalThis";
        const declaration = targetOf(node);
        if (
          declaration !== undefined &&
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer !== undefined
        )
          return globalName(declaration.initializer, seen);
        return declaration !== undefined &&
          /^lib\.[\w.]*\.d\.ts$/.test(basename(declaration.getSourceFile().fileName))
          ? node.text
          : null;
      };
      for (const sf of program.getSourceFiles()) {
        const path = local(sf.fileName);
        if (!source.has(path)) continue;
        const comments = new Map<number, ts.CommentRange>();
        const visit = (node: ts.Node): void => {
          let runtime = true;
          for (let parent: ts.Node | undefined = node; parent !== undefined; parent = parent.parent)
            if (ts.isTypeNode(parent) || (ts.isImportClause(parent) && parent.isTypeOnly))
              runtime = false;
          for (const comment of [
            ...(ts.getLeadingCommentRanges(sf.text, node.pos) ?? []),
            ...(ts.getTrailingCommentRanges(sf.text, node.end) ?? []),
          ])
            comments.set(comment.pos, comment);
          if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
          ) {
            imports.push({
              file: path,
              specifier: node.moduleSpecifier.text,
              target: importTarget(node.moduleSpecifier.text, sf.fileName),
              typeOnly: typeOnlyOf(node),
            });
          }
          if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
            contracts.push({
              file: path,
              name: node.name.text,
              parameter: null,
              operations: operationsOf(checker.getTypeAtLocation(node)),
              type: contractIdentity(checker.getTypeAtLocation(node)),
            });
          if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
            for (const [index, parameter] of node.parameters.entries()) {
              contracts.push({
                file: path,
                name: node.name.text,
                parameter: index,
                operations: operationsOf(checker.getTypeAtLocation(parameter)),
                type: contractIdentity(checker.getTypeAtLocation(parameter)),
              });
              if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
                parameters.push({
                  file: path,
                  start: parameter.getStart(sf),
                  name: parameter.name.getText(sf),
                  ...typeFacts(checker.getTypeAtLocation(parameter)),
                });
            }
          }
          if (
            (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
            ts.isVariableDeclaration(node.parent) &&
            ts.isVariableDeclarationList(node.parent.parent) &&
            ts.isVariableStatement(node.parent.parent.parent) &&
            node.parent.parent.parent.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
            )
          ) {
            for (const [index, parameter] of node.parameters.entries()) {
              const type = checker.getTypeAtLocation(parameter);
              const name = node.parent.name.getText(sf);
              contracts.push({
                file: path,
                name,
                parameter: index,
                operations: operationsOf(type),
                type: contractIdentity(type),
              });
              parameters.push({
                file: path,
                start: parameter.getStart(sf),
                name: parameter.name.getText(sf),
                ...typeFacts(type),
              });
            }
          }
          if (ts.isObjectLiteralExpression(node)) {
            const type = checker.getContextualType(node) ?? checker.getTypeAtLocation(node);
            constructions.push({
              file: path,
              start: node.getStart(sf),
              callable: typeFacts(type).callable,
              types: [
                ...typeNames(type),
                ...node.properties.flatMap((property) =>
                  ts.isSpreadAssignment(property)
                    ? typeNames(checker.getTypeAtLocation(property.expression))
                    : [],
                ),
              ],
              spread: node.properties.some(ts.isSpreadAssignment),
            });
          }
          if (ts.isCallExpression(node)) {
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
              const specifier = node.arguments[0];
              if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
                imports.push({
                  file: path,
                  specifier: specifier.text,
                  target: importTarget(specifier.text, sf.fileName),
                  typeOnly: false,
                });
              } else accesses.push({ file: path, start: node.getStart(sf), kind: "dynamic" });
            }
            if (
              ts.isPropertyAccessExpression(node.expression) &&
              globalName(node.expression.expression) === "Reflect" &&
              node.expression.name.text === "get" &&
              node.arguments[0] !== undefined &&
              globalName(node.arguments[0]) === "globalThis"
            )
              accesses.push({ file: path, start: node.getStart(sf), kind: "dynamic" });
            const declaration = targetOf(node.expression);
            const raw = rawAccess(node.expression);
            if (raw !== null) accesses.push({ file: path, start: node.getStart(sf), kind: raw });
            const callableOrigins = node.arguments
              .filter(
                (argument) => checker.getTypeAtLocation(argument).getCallSignatures().length > 0,
              )
              .map((argument) => {
                const origin =
                  ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
                    ? argument
                    : targetOf(argument);
                return origin === undefined || origin.getSourceFile().isDeclarationFile
                  ? null
                  : local(origin.getSourceFile().fileName);
              });
            if (callableOrigins.length > 0)
              connections.push({
                file: path,
                start: node.getStart(sf),
                target:
                  declaration === undefined || declaration.getSourceFile().isDeclarationFile
                    ? null
                    : local(declaration.getSourceFile().fileName),
                callableOrigins,
                builtin:
                  raw === "clock" ||
                  raw === "randomness" ||
                  (declaration !== undefined &&
                    ts.isMethodSignature(declaration) &&
                    ts.isInterfaceDeclaration(declaration.parent) &&
                    /^lib\.es[\w.]*\.d\.ts$/.test(basename(declaration.getSourceFile().fileName)) &&
                    ((["Array", "ReadonlyArray"].includes(declaration.parent.name.text) &&
                      [
                        "sort",
                        "map",
                        "filter",
                        "reduce",
                        "reduceRight",
                        "flatMap",
                        "some",
                        "every",
                        "find",
                        "findIndex",
                        "forEach",
                        "toSorted",
                      ].includes(declaration.name.getText())) ||
                      (declaration.parent.name.text === "String" &&
                        ["trim", "localeCompare"].includes(declaration.name.getText())))),
              });
          }
          if (ts.isPropertyAccessExpression(node)) {
            const raw = runtime ? rawAccess(node) : null;
            if (raw !== null) accesses.push({ file: path, start: node.getStart(sf), kind: raw });
          }
          if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
            const raw = rawAccess(node.name);
            if (raw !== null) accesses.push({ file: path, start: node.getStart(sf), kind: raw });
          }
          if (ts.isNewExpression(node)) {
            const name = globalName(node.expression);
            const kind =
              name === "Date" && (node.arguments?.length ?? 0) === 0
                ? "clock"
                : name === "Function"
                  ? "dynamic"
                  : null;
            if (kind !== null) accesses.push({ file: path, start: node.getStart(sf), kind });
          }
          if (
            ts.isElementAccessExpression(node) &&
            (node.expression.getText(sf) === "globalThis" ||
              ["Date", "Math", "Reflect"].includes(globalName(node.expression) ?? ""))
          )
            accesses.push({ file: path, start: node.getStart(sf), kind: "dynamic" });
          if (ts.isIdentifier(node)) {
            if (
              runtime &&
              !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) &&
              rawAccess(node) === "dynamic"
            )
              accesses.push({ file: path, start: node.getStart(sf), kind: "dynamic" });
            const symbol = checker.getSymbolAtLocation(node);
            const declaration = symbol?.declarations?.find(
              (d) => d.getSourceFile().isDeclarationFile,
            );
            if (
              declaration !== undefined &&
              !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
              !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
            )
              globals.push({
                file: path,
                name: node.text,
                start: node.getStart(sf),
                declarationFile: local(declaration.getSourceFile().fileName),
                runtime,
              });
          }
          if (ts.isPropertyAccessExpression(node)) {
            const symbol = checker.getSymbolAtLocation(node.name);
            const declaration = symbol?.declarations?.find(
              (d) => d.getSourceFile().isDeclarationFile,
            );
            if (declaration !== undefined)
              globals.push({
                file: path,
                name: node.getText(sf),
                start: node.getStart(sf),
                declarationFile: local(declaration.getSourceFile().fileName),
                runtime,
              });
          }
          const kind =
            node.kind === ts.SyntaxKind.AnyKeyword
              ? "any"
              : (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
                  !(
                    ts.isTypeReferenceNode(node.type) &&
                    ts.isIdentifier(node.type.typeName) &&
                    node.type.typeName.text === "const"
                  )
                ? "assertion"
                : ts.isNonNullExpression(node) && !ts.isElementAccessExpression(node.expression)
                  ? "non-null"
                  : null;
          if (kind !== null) escapes.push({ file: path, start: node.getStart(sf), kind });
          ts.forEachChild(node, visit);
        };
        visit(sf);
        const module = checker.getSymbolAtLocation(sf);
        for (const exported of module === undefined ? [] : checker.getExportsOfModule(module)) {
          const target =
            (exported.flags & ts.SymbolFlags.Alias) !== 0
              ? checker.getAliasedSymbol(exported)
              : exported;
          const declaration = target.valueDeclaration ?? target.declarations?.[0];
          if (declaration === undefined) continue;
          const type = checker.getTypeAtLocation(declaration);
          const explicit =
            ts.isVariableDeclaration(declaration) ||
            ts.isFunctionDeclaration(declaration) ||
            ts.isPropertyDeclaration(declaration)
              ? declaration.type !== undefined
              : ts.isInterfaceDeclaration(declaration) ||
                ts.isTypeAliasDeclaration(declaration) ||
                ts.isClassDeclaration(declaration) ||
                ts.isEnumDeclaration(declaration);
          const initializer = ts.isVariableDeclaration(declaration)
            ? declaration.initializer
            : undefined;
          const signatures = type.getCallSignatures();
          const returnNode =
            signatures.length === 1 ? signatures[0]?.getDeclaration()?.type : undefined;
          const resultDeclaration =
            returnNode !== undefined && ts.isTypeReferenceNode(returnNode)
              ? targetOf(returnNode.typeName)
              : undefined;
          const returned =
            signatures.length === 1 && signatures[0] !== undefined
              ? checker.getReturnTypeOfSignature(signatures[0])
              : undefined;
          const actualResultSymbol = returned?.aliasSymbol ?? returned?.symbol;
          const resultType =
            resultDeclaration !== undefined &&
            (ts.isInterfaceDeclaration(resultDeclaration) ||
              ts.isTypeAliasDeclaration(resultDeclaration)) &&
            actualResultSymbol?.name === resultDeclaration.name.text &&
            source.has(local(resultDeclaration.getSourceFile().fileName))
              ? {
                  file: local(resultDeclaration.getSourceFile().fileName),
                  name: resultDeclaration.name.text,
                }
              : null;
          exports.push({
            file: path,
            name: exported.name,
            declarationFile: local(declaration.getSourceFile().fileName),
            type: checker.typeToString(type),
            explicit,
            any: (type.flags & ts.TypeFlags.Any) !== 0,
            unknown: (type.flags & ts.TypeFlags.Unknown) !== 0,
            primitive:
              (type.flags &
                (ts.TypeFlags.String |
                  ts.TypeFlags.Number |
                  ts.TypeFlags.Boolean |
                  ts.TypeFlags.BigInt |
                  ts.TypeFlags.ESSymbol)) !==
              0,
            union: type.isUnion(),
            satisfies:
              initializer !== undefined && ts.isSatisfiesExpression(initializer)
                ? initializer.type.getText(declaration.getSourceFile())
                : null,
            resultType,
          });
        }
        for (const comment of comments.values()) {
          for (const match of sf.text
            .slice(comment.pos, comment.end)
            .matchAll(/@ts-(ignore|nocheck|expect-error)\b/g)) {
            const kind = match[1];
            if (kind === "ignore" || kind === "nocheck" || kind === "expect-error")
              escapes.push({ file: path, start: comment.pos + match.index, kind });
          }
        }
      }
      const zone = /^tsconfig\.(core|shell|substrate)\.json$/.exec(basename(file))?.[1];
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
        imports,
        exports,
        globals,
        escapes,
        parameters,
        contracts,
        accesses,
        constructions,
        connections,
      };
    });
  return { version: ts.version, projects };
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

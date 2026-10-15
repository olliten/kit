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
import { semanticReferenceInventory } from "../../core/readings/semantic-references.js";
import { termInventory } from "../../core/readings/term-inventory.js";
import { compilerWorkspace } from "../adapters/compiler.js";
import { filesystem } from "../adapters/filesystem.js";

// The kit's only effect: read one snapshot of the codebase at `appRoot`. Only imports that resolve to a file
// of the snapshot are recorded. Terms come only from the config's terms file, as lines
// `- **<term>** — <meaning>` optionally ending `Retired: <word>, <word>.`; its headings are sections. A source file's exported symbols are its top-level declarations
// `export [async] function|const|class|type|interface <name>`.
const SKIP_DIR = /^(?:node_modules|\..*)$/;
const IMPORT = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const EXPORT =
  /^export\s+(?:async\s+)?(?:function\*?|const|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm;
const SOURCE = /\.(?:ts|tsx|mts|js|mjs)$/;

export function readSnapshot(appRoot: string, config: KitConfig = DEFAULT_CONFIG): Snapshot {
  const paths = walk(appRoot).map((abs) => relative(appRoot, abs).split(sep).join("/"));
  const files: SnapshotFile[] = paths.sort().map((path) => ({ path, type: typeOf(path, config) }));
  const known = new Set(paths);
  const imports: ImportEdge[] = [];
  const terms: SpecTerm[] = [];
  const termSyntax: NonNullable<Snapshot["termSyntax"]>[number][] = [];
  const termOrder: NonNullable<Snapshot["termOrder"]>[number][] = [];
  const prose: SpecProse[] = [];
  const symbols: ExportedSymbol[] = [];
  const comments: SnapshotComment[] = [];
  const claims: NonNullable<Snapshot["claims"]>[number][] = [];
  const claimReferences: NonNullable<Snapshot["claimReferences"]>[number][] = [];
  const semanticReferences: NonNullable<Snapshot["semanticReferences"]>[number][] = [];
  for (const { path, type } of files) {
    if (type === "other") continue;
    const text = filesystem.readText(join(appRoot, path));
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
  const compiler = readCompiler(appRoot, paths, files, config);
  return {
    files,
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

function readCompiler(
  appRoot: string,
  paths: readonly string[],
  files: readonly SnapshotFile[],
  config: KitConfig,
): CompilerFacts {
  const source = new Set(files.filter((file) => file.type === "source").map((file) => file.path));
  const local = (file: string): string => relative(appRoot, file).split(sep).join("/");
  const shellPrefix = `${config.srcRoot}/shell/${config.layerNames?.compositions ?? "compositions"}/`;
  const shellCompositions = new Set(
    [...source].filter(
      (path) => path.startsWith(shellPrefix) && !path.slice(shellPrefix.length).includes("/"),
    ),
  );
  const externalAdapters = new Set(
    (config.adapters ?? []).flatMap((adapter) => {
      const [zone, layer, name] = adapter.module.split("/");
      return adapter.kind === "external" &&
        (zone === "shell" || zone === "substrate") &&
        layer === "adapters" &&
        name !== undefined
        ? [`${config.srcRoot}/${zone}/${config.layerNames?.adapters ?? layer}/${name}.ts`]
        : [];
    }),
  );
  const projects = paths
    .filter((path) => /^tsconfig(?:\.[\w-]+)*\.json$/.test(basename(path)))
    .map((file): Project => {
      const absolute = join(appRoot, file);
      const { parsed, readError, program } = compilerWorkspace.load(absolute);
      const checker = program.getTypeChecker();
      const importTarget = (specifier: string, containingFile: string): string | null => {
        const resolved = compilerWorkspace.resolve(specifier, containingFile, parsed.options);
        return resolved === undefined ? null : local(resolved.resolvedFileName);
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
      const imports: Project["imports"][number][] = [];
      const exports: Project["exports"][number][] = [];
      const globals: Project["globals"][number][] = [];
      const escapes: Project["escapes"][number][] = [];
      const parameters = new Map<
        ts.ParameterDeclaration,
        Project["parameters"][number] & { readonly exported: boolean }
      >();
      const contracts: Project["contracts"][number][] = [];
      const accesses: Project["accesses"][number][] = [];
      const constructions: Project["constructions"][number][] = [];
      const connections: Project["connections"][number][] = [];
      const termSources: NonNullable<Project["termFacts"]>["sources"][number][] = [];
      const termTypes: NonNullable<Project["termFacts"]>["types"][number][] = [];
      const targetOf = (node: ts.Node): ts.Declaration | undefined => {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
          symbol = checker.getAliasedSymbol(symbol);
        return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      };
      type TypeFacts = {
        readonly callable: boolean;
        readonly accessor: boolean;
        readonly types: readonly { readonly file: string; readonly name: string }[];
      };
      const completeTypeFacts = new Map<ts.Type, TypeFacts>();
      const completeArgumentFacts = new Map<ts.Type, TypeFacts>();
      const completeAdapterArgumentFacts = new Map<ts.Type, TypeFacts>();
      const referenceType = (type: ts.Type): type is ts.TypeReference =>
        "objectFlags" in type &&
        typeof type.objectFlags === "number" &&
        (type.objectFlags & ts.ObjectFlags.Reference) !== 0;
      type NativeAuthority = NonNullable<Project["parameters"][number]["nativeAuthority"]>[number];
      type NativeType = NativeAuthority["root"];
      const nativeLibrary = (node: ts.Node): boolean =>
        program.isSourceFileDefaultLibrary(node.getSourceFile()) &&
        /^lib\.dom(?:\.[\w-]+)*\.d\.ts$/.test(basename(node.getSourceFile().fileName));
      const nativeMember = (symbol: ts.Symbol): boolean =>
        symbol.declarations?.some(
          (node) =>
            nativeLibrary(node) &&
            (ts.isMethodSignature(node) ||
              ts.isMethodDeclaration(node) ||
              ts.isGetAccessorDeclaration(node) ||
              ts.isSetAccessorDeclaration(node)),
        ) === true;
      const nativeType = (type: ts.Type): NativeType | null => {
        const symbol = type.symbol;
        const declaration = symbol?.declarations?.find(
          (node) =>
            nativeLibrary(node) && (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)),
        );
        return declaration !== undefined &&
          type
            .getProperties()
            .some((property) =>
              property.declarations?.some(
                (node) =>
                  nativeLibrary(node) &&
                  (ts.isMethodSignature(node) ||
                    ts.isMethodDeclaration(node) ||
                    ts.isGetAccessorDeclaration(node) ||
                    ts.isSetAccessorDeclaration(node)),
              ),
            )
          ? { file: local(declaration.getSourceFile().fileName), name: symbol?.name ?? "" }
          : null;
      };
      const baseTypes = (type: ts.Type): readonly ts.BaseType[] => {
        const target = referenceType(type) ? type.target : type;
        return target.isClassOrInterface() ? checker.getBaseTypes(target) : [];
      };
      const nativeCache = new Map<ts.Type, readonly NativeAuthority[]>();
      const nativeAuthorityOf = (
        type: ts.Type,
        seen = new Set<ts.Type>(),
      ): readonly NativeAuthority[] => {
        const complete = seen.size === 0;
        const cached = complete ? nativeCache.get(type) : undefined;
        if (cached !== undefined) return cached;
        if (seen.has(type)) return [];
        seen.add(type);
        const root = nativeType(type);
        let result: readonly NativeAuthority[];
        if (root !== null) {
          const queue = [...baseTypes(type)];
          const visited = new Set<ts.Type>();
          const bases: NativeType[] = [];
          for (const base of queue) {
            if (visited.has(base)) continue;
            visited.add(base);
            const identity = nativeType(base);
            if (identity !== null) bases.push(identity);
            queue.push(...baseTypes(base));
          }
          result = [{ root, bases }];
        } else {
          const constraint =
            (type.flags & ts.TypeFlags.TypeParameter) !== 0
              ? checker.getBaseConstraintOfType(type)
              : undefined;
          const contents = type.isUnionOrIntersection()
            ? type.types
            : type.getCallSignatures().length > 0
              ? []
              : [
                  ...(constraint === undefined ? [] : [constraint]),
                  ...(type.aliasTypeArguments ?? []),
                  ...(referenceType(type) ? checker.getTypeArguments(type) : []),
                  ...((type.flags & ts.TypeFlags.Object) === 0
                    ? []
                    : type.getProperties().flatMap((property) => {
                        const declaration = property.valueDeclaration ?? property.declarations?.[0];
                        return declaration !== undefined &&
                          (ts.isPropertySignature(declaration) ||
                            ts.isPropertyDeclaration(declaration) ||
                            ts.isPropertyAssignment(declaration) ||
                            ts.isShorthandPropertyAssignment(declaration) ||
                            (ts.isParameter(declaration) &&
                              ts.isConstructorDeclaration(declaration.parent) &&
                              ts.isParameterPropertyDeclaration(declaration, declaration.parent)))
                          ? [checker.getTypeOfSymbolAtLocation(property, declaration)]
                          : [];
                      })),
                ];
          const children = [
            ...type
              .getConstructSignatures()
              .map((signature) => checker.getReturnTypeOfSignature(signature)),
            ...contents,
          ];
          result = [
            ...new Map(
              children
                .flatMap((child) => nativeAuthorityOf(child, seen))
                .map((authority) => [`${authority.root.file}:${authority.root.name}`, authority]),
            ).values(),
          ];
        }
        if (complete) nativeCache.set(type, result);
        return result;
      };
      const nativeMemberAuthority = (
        member: ts.Symbol,
        receiver: ts.Type,
        location: ts.Node,
      ): readonly NativeAuthority[] => {
        if (nativeMember(member)) return nativeAuthorityOf(receiver);
        const type = checker.getTypeOfSymbolAtLocation(member, location);
        return type.getConstructSignatures().length > 0 ? nativeAuthorityOf(type) : [];
      };
      const nativeContract = (
        type: ts.Type,
      ): { readonly nativeAuthority: readonly NativeAuthority[] } => ({
        nativeAuthority: [
          ...new Map(
            [
              ...nativeAuthorityOf(type),
              ...[
                ...type.getCallSignatures(),
                ...type.getProperties().flatMap((property) => {
                  const declaration = property.valueDeclaration ?? property.declarations?.[0];
                  return declaration === undefined
                    ? []
                    : checker.getTypeOfSymbolAtLocation(property, declaration).getCallSignatures();
                }),
              ].flatMap((signature) => [
                ...nativeAuthorityOf(checker.getReturnTypeOfSignature(signature)),
                ...signature.parameters.flatMap((parameter) => {
                  const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
                  return declaration === undefined
                    ? []
                    : nativeAuthorityOf(checker.getTypeOfSymbolAtLocation(parameter, declaration));
                }),
              ]),
            ].map((authority) => [`${authority.root.file}:${authority.root.name}`, authority]),
          ).values(),
        ],
      });
      const typeFacts = (
        type: ts.Type,
        seen = new Set<ts.Type>(),
        supplied: boolean | "adapter" = false,
      ): TypeFacts => {
        const cache =
          supplied === "adapter"
            ? completeAdapterArgumentFacts
            : supplied
              ? completeArgumentFacts
              : completeTypeFacts;
        const complete = seen.size === 0;
        if (complete) {
          const cached = cache.get(type);
          if (cached !== undefined) return cached;
        }
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
        else if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
          const constraint = checker.getBaseConstraintOfType(type);
          children = constraint === undefined ? [] : [constraint];
        } else if (
          checker.isArrayLikeType(type) ||
          checker.isTupleType(type) ||
          symbol?.name === "ReadonlyArray"
        ) {
          const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
          children = [
            ...(element === undefined ? [] : [element]),
            ...type.getProperties().flatMap((property) => {
              const declaration = property.valueDeclaration ?? property.declarations?.[0];
              if (
                declaration === undefined ||
                (supplied && program.isSourceFileDefaultLibrary(declaration.getSourceFile())) ||
                (ts.isMethodSignature(declaration) &&
                  ts.isInterfaceDeclaration(declaration.parent) &&
                  ["Array", "ReadonlyArray"].includes(declaration.parent.name.text) &&
                  /^lib\.es[\w.]*\.d\.ts$/.test(basename(declaration.getSourceFile().fileName)))
              )
                return [];
              return [checker.getTypeOfSymbolAtLocation(property, declaration)];
            }),
          ];
        } else if (
          (type.flags & ts.TypeFlags.Object) !== 0 &&
          !symbol?.declarations?.some(
            (node) => ts.isClassDeclaration(node) || ts.isClassExpression(node),
          )
        )
          children = type.getProperties().flatMap((property) => {
            const declaration = property.valueDeclaration ?? property.declarations?.[0];
            return declaration === undefined ||
              (supplied && program.isSourceFileDefaultLibrary(declaration.getSourceFile()))
              ? []
              : [checker.getTypeOfSymbolAtLocation(property, declaration)];
          });
        const facts = [
          ...children,
          ...(type.aliasTypeArguments ?? []),
          ...(supplied && referenceType(type) ? checker.getTypeArguments(type) : []),
        ].map((child) => typeFacts(child, seen, supplied));
        const result: TypeFacts = {
          callable: type.getCallSignatures().length > 0 || facts.some((fact) => fact.callable),
          accessor:
            symbol?.declarations?.some(
              (node) => ts.isClassDeclaration(node) || ts.isClassExpression(node),
            ) === true ||
            type
              .getProperties()
              .some((property) =>
                property.declarations?.some(
                  (node) =>
                    ts.isGetAccessorDeclaration(node) &&
                    (supplied !== "adapter" ||
                      !program.isSourceFileDefaultLibrary(node.getSourceFile())),
                ),
              ) ||
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
        if (complete) cache.set(type, result);
        return result;
      };
      const parameterFacts = (
        type: ts.Type,
      ): TypeFacts & {
        readonly executable: boolean;
        readonly nativeAuthority: readonly NativeAuthority[];
      } => {
        const supplied = typeFacts(type, new Set(), "adapter");
        return {
          ...typeFacts(type),
          executable: supplied.callable || supplied.accessor,
          nativeAuthority: nativeAuthorityOf(type),
        };
      };
      const recordParameter = (parameter: ts.ParameterDeclaration, exported = false): void => {
        const sf = parameter.getSourceFile();
        const file = local(sf.fileName);
        if (sf.isDeclarationFile || !source.has(file)) return;
        parameters.set(parameter, {
          file,
          start: parameter.getStart(sf),
          name: parameter.name.getText(sf),
          ...parameterFacts(checker.getTypeAtLocation(parameter)),
          exported: exported || parameters.get(parameter)?.exported === true,
        });
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
      const literal = (node: ts.Expression, seen = new Set<ts.Expression>()): boolean => {
        if (seen.has(node)) return false;
        seen.add(node);
        if (ts.isIdentifier(node)) {
          const declaration = targetOf(node);
          return (
            declaration !== undefined &&
            ts.isVariableDeclaration(declaration) &&
            ts.isVariableDeclarationList(declaration.parent) &&
            (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
            declaration.initializer !== undefined &&
            literal(declaration.initializer, seen)
          );
        }
        if (ts.isAsExpression(node))
          return node.type.getText() === "const" && literal(node.expression, seen);
        if (ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node))
          return literal(node.expression, seen);
        if (
          ts.isLiteralExpression(node) ||
          node.kind === ts.SyntaxKind.TrueKeyword ||
          node.kind === ts.SyntaxKind.FalseKeyword ||
          node.kind === ts.SyntaxKind.NullKeyword
        )
          return true;
        if (ts.isPrefixUnaryExpression(node))
          return (
            (node.operator === ts.SyntaxKind.MinusToken ||
              node.operator === ts.SyntaxKind.PlusToken) &&
            ts.isNumericLiteral(node.operand)
          );
        if (ts.isArrayLiteralExpression(node))
          return node.elements.every(
            (element) => ts.isExpression(element) && literal(element, new Set(seen)),
          );
        if (ts.isObjectLiteralExpression(node))
          return node.properties.every(
            (property) =>
              ts.isPropertyAssignment(property) &&
              !ts.isComputedPropertyName(property.name) &&
              literal(property.initializer, new Set(seen)),
          );
        return false;
      };
      const annotation = (
        node: ts.TypeNode,
        seen = new Set<ts.Node>(),
      ): {
        types: { file: string; name: string }[];
        absence: ("undefined" | "null")[];
        other: boolean;
        unsupported: boolean;
      } => {
        const empty = { types: [], absence: [], other: false, unsupported: false };
        if (seen.has(node)) return { ...empty, unsupported: true };
        seen.add(node);
        if (ts.isParenthesizedTypeNode(node)) return annotation(node.type, seen);
        if (ts.isUnionTypeNode(node)) {
          const parts = node.types.map((part) => annotation(part, new Set(seen)));
          return {
            types: parts.flatMap((part) => part.types),
            absence: parts.flatMap((part) => part.absence),
            other: parts.some((part) => part.other),
            unsupported: parts.some((part) => part.unsupported),
          };
        }
        if (node.kind === ts.SyntaxKind.UndefinedKeyword)
          return { ...empty, absence: ["undefined"] };
        if (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword)
          return { ...empty, absence: ["null"] };
        if (ts.isTypeReferenceNode(node)) {
          const target = targetOf(node.typeName);
          if (target && ts.isTypeAliasDeclaration(target) && ts.isTypeReferenceNode(target.type))
            return annotation(target.type, seen);
          if (
            target &&
            (ts.isInterfaceDeclaration(target) || ts.isTypeAliasDeclaration(target)) &&
            !node.typeArguments?.length
          )
            return {
              ...empty,
              types: [{ file: local(target.getSourceFile().fileName), name: target.name.text }],
            };
          return { ...empty, unsupported: true };
        }
        if (
          node.kind === ts.SyntaxKind.StringKeyword ||
          node.kind === ts.SyntaxKind.NumberKeyword ||
          node.kind === ts.SyntaxKind.BooleanKeyword ||
          ts.isLiteralTypeNode(node)
        )
          return { ...empty, other: true };
        return { ...empty, unsupported: true };
      };
      for (const sf of program.getSourceFiles()) {
        const path = local(sf.fileName);
        if (!source.has(path)) continue;
        const comments = new Map<number, ts.CommentRange>();
        const visit = (node: ts.Node): void => {
          let runtime = true;
          for (let parent: ts.Node | undefined = node; parent !== undefined; parent = parent.parent)
            if (
              ts.isTypeNode(parent) ||
              ts.isInterfaceDeclaration(parent) ||
              ts.isTypeAliasDeclaration(parent) ||
              (ts.isImportClause(parent) && parent.isTypeOnly)
            )
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
              ...nativeContract(checker.getTypeAtLocation(node)),
            });
          if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
            for (const [index, parameter] of node.parameters.entries()) {
              contracts.push({
                file: path,
                name: node.name.text,
                parameter: index,
                operations: operationsOf(checker.getTypeAtLocation(parameter)),
                type: contractIdentity(checker.getTypeAtLocation(parameter)),
                ...nativeContract(checker.getTypeAtLocation(parameter)),
              });
              if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
                recordParameter(parameter, true);
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
                ...nativeContract(type),
              });
              recordParameter(parameter, true);
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
            const nativeDestination =
              declaration !== undefined &&
              (externalAdapters.has(local(declaration.getSourceFile().fileName)) ||
                shellCompositions.has(local(declaration.getSourceFile().fileName)));
            const callableArguments = node.arguments.flatMap((argument, index) => {
              const facts = typeFacts(
                checker.getTypeAtLocation(argument),
                new Set(),
                nativeDestination ? "adapter" : true,
              );
              if (!facts.callable && !facts.accessor) return [];
              let input = argument;
              while (
                ts.isParenthesizedExpression(input) ||
                ts.isPropertyAccessExpression(input) ||
                ts.isElementAccessExpression(input)
              )
                input = input.expression;
              let source = targetOf(input);
              while (source !== undefined && ts.isBindingElement(source)) {
                const parent = source.parent.parent;
                source = ts.isParameter(parent) ? parent : undefined;
              }
              const parameter = source !== undefined && ts.isParameter(source) ? source : null;
              const origin =
                parameter !== null
                  ? parameter
                  : ts.isArrowFunction(argument) ||
                      ts.isFunctionExpression(argument) ||
                      ts.isObjectLiteralExpression(argument) ||
                      ts.isArrayLiteralExpression(argument) ||
                      ts.isNewExpression(argument)
                    ? argument
                    : targetOf(argument);
              const called =
                declaration !== undefined && ts.isVariableDeclaration(declaration)
                  ? declaration.initializer
                  : declaration;
              const targetParameter =
                called !== undefined && ts.isFunctionLike(called)
                  ? called.parameters[index]
                  : undefined;
              if (parameter !== null) recordParameter(parameter);
              if (targetParameter !== undefined) recordParameter(targetParameter);
              return [
                {
                  origin:
                    origin === undefined || origin.getSourceFile().isDeclarationFile
                      ? null
                      : local(origin.getSourceFile().fileName),
                  source:
                    parameter === null
                      ? null
                      : {
                          file: local(parameter.getSourceFile().fileName),
                          start: parameter.getStart(),
                        },
                  target:
                    targetParameter === undefined ||
                    targetParameter.getSourceFile().isDeclarationFile
                      ? null
                      : {
                          file: local(targetParameter.getSourceFile().fileName),
                          start: targetParameter.getStart(),
                        },
                },
              ];
            });
            if (callableArguments.length > 0)
              connections.push({
                file: path,
                start: node.getStart(sf),
                target:
                  declaration === undefined || declaration.getSourceFile().isDeclarationFile
                    ? null
                    : local(declaration.getSourceFile().fileName),
                callableOrigins: callableArguments.map((argument) => argument.origin),
                callableBindings: callableArguments.map(({ source, target }) => ({
                  source,
                  target,
                })),
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
          if (
            runtime &&
            (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
          ) {
            const receiver = checker.getTypeAtLocation(node.expression);
            const key = ts.isElementAccessExpression(node)
              ? checker.getTypeAtLocation(node.argumentExpression)
              : null;
            const member = ts.isPropertyAccessExpression(node)
              ? checker.getSymbolAtLocation(node.name)
              : key?.isStringLiteral()
                ? receiver.getProperty(key.value)
                : undefined;
            const authority =
              member === undefined ? [] : nativeMemberAuthority(member, receiver, node);
            if (member !== undefined && (nativeMember(member) || authority.length > 0))
              accesses.push({
                file: path,
                start: node.getStart(sf),
                kind: "native",
                nativeAuthority: authority,
              });
          }
          if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
            const raw = rawAccess(node.name);
            if (raw !== null) accesses.push({ file: path, start: node.getStart(sf), kind: raw });
            const owner = node.parent.parent;
            const key = node.propertyName ?? node.name;
            if (
              runtime &&
              ts.isObjectBindingPattern(node.parent) &&
              ts.isVariableDeclaration(owner) &&
              owner.initializer !== undefined &&
              (ts.isIdentifier(key) || ts.isStringLiteralLike(key))
            ) {
              const receiver = checker.getTypeAtLocation(owner.initializer);
              const member = receiver.getProperty(key.text);
              const authority =
                member === undefined ? [] : nativeMemberAuthority(member, receiver, node);
              if (member !== undefined && (nativeMember(member) || authority.length > 0))
                accesses.push({
                  file: path,
                  start: node.getStart(sf),
                  kind: "native",
                  nativeAuthority: authority,
                });
            }
          }
          // A cast erases which global is reached, so the authority it acquires has no identity.
          if (
            (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
            globalName(node.expression) === "globalThis"
          )
            accesses.push({ file: path, start: node.getStart(sf), kind: "dynamic" });
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
                nativeAuthority: nativeAuthorityOf(checker.getTypeAtLocation(node)),
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
        termSources.push({
          file: path,
          factOnly: sf.statements.every(
            (statement) =>
              ts.isInterfaceDeclaration(statement) ||
              ts.isTypeAliasDeclaration(statement) ||
              ts.isImportDeclaration(statement) ||
              ts.isExportDeclaration(statement) ||
              (ts.isVariableStatement(statement) &&
                (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
                statement.declarationList.declarations.every(
                  (declaration) =>
                    declaration.initializer !== undefined && literal(declaration.initializer),
                )),
          ),
        });
        for (const statement of sf.statements) {
          if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement))
            continue;
          const type = checker.getTypeAtLocation(statement);
          const properties = checker.getPropertiesOfType(type).map((property) => {
            const declaration = property.declarations?.find(ts.isPropertySignature);
            const facts = declaration?.type
              ? annotation(declaration.type)
              : { types: [], absence: [], other: false, unsupported: true };
            const absence: ("undefined" | "null")[] = [...facts.absence];
            if (declaration?.questionToken && !absence.includes("undefined"))
              absence.push("undefined");
            return { name: property.name, ...facts, absence };
          });
          termTypes.push({ file: path, name: statement.name.text, properties });
        }
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
          const actualResultIdentity = returned === undefined ? null : contractIdentity(returned);
          const resultType =
            resultDeclaration !== undefined &&
            (ts.isInterfaceDeclaration(resultDeclaration) ||
              ts.isTypeAliasDeclaration(resultDeclaration)) &&
            actualResultSymbol?.name === resultDeclaration.name.text &&
            source.has(local(resultDeclaration.getSourceFile().fileName))
              ? actualResultIdentity
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
        parameters: [...parameters.values()],
        contracts,
        accesses,
        constructions,
        connections,
        termFacts: { sources: termSources, types: termTypes },
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
  return filesystem.entries(dir).flatMap((entry) => {
    const abs = join(dir, entry.name);
    if (entry.directory) return SKIP_DIR.test(entry.name) ? [] : walk(abs);
    return entry.file ? [abs] : [];
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

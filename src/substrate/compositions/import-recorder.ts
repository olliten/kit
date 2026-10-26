import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import { moduleFileOf } from "../../core/readings/placement-of.js";
import type { ProgramScope } from "../primitives/program-scope.js";
import type { BehaviourReading } from "./behaviour-reading.js";
import type { ContractReading } from "./contract-reading.js";
import type { FileScope } from "./file-scope.js";
import type { SyntaxReading } from "./syntax-reading.js";

type Project = CompilerFacts["projects"][number];

// Where a file's imports lead, static and dynamic, as the compiler resolves them, and what each of its exports
// is: its type, whether it is declared explicitly, the contract it returns, and whether it takes behaviour.
export function importRecorder(
  { config, checker, local, source }: ProgramScope,
  importTarget: (specifier: string, containingFile: string) => string | null,
  ambientTargets: ReadonlyMap<string, { readonly declarationTarget: string }>,
  { targetOf, typeOnlyOf }: SyntaxReading,
  { contractIdentity }: ContractReading,
  { acceptsBehaviour }: BehaviourReading,
) {
  const imports: Project["imports"][number][] = [];
  const exports: Project["exports"][number][] = [];
  return {
    imports,
    exports,
    visit({ sf, path }: FileScope, node: ts.Node): void {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push({
          file: path,
          specifier: node.moduleSpecifier.text,
          target: importTarget(node.moduleSpecifier.text, sf.fileName),
          ...ambientTargets.get(JSON.stringify(node.moduleSpecifier.text)),
          typeOnly: typeOnlyOf(node),
          namedImports:
            ts.isImportDeclaration(node) &&
            node.importClause?.name === undefined &&
            node.importClause?.namedBindings !== undefined &&
            ts.isNamedImports(node.importClause.namedBindings)
              ? node.importClause.namedBindings.elements
                  .filter((binding) => !binding.isTypeOnly)
                  .map((binding) => (binding.propertyName ?? binding.name).text)
              : null,
        });
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0];
        if (specifier !== undefined && ts.isStringLiteralLike(specifier))
          imports.push({
            file: path,
            specifier: specifier.text,
            target: importTarget(specifier.text, sf.fileName),
            ...ambientTargets.get(JSON.stringify(specifier.text)),
            typeOnly: false,
            namedImports: null,
          });
      }
    },
    end({ sf, path }: FileScope): void {
      const module = checker.getSymbolAtLocation(sf);
      for (const exported of module === undefined ? [] : checker.getExportsOfModule(module)) {
        const target = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported;
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
        const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
        const signatures = type.getCallSignatures();
        const returnNode = signatures.length === 1 ? signatures[0]?.getDeclaration()?.type : undefined;
        const resultDeclaration =
          returnNode !== undefined && ts.isTypeReferenceNode(returnNode) ? targetOf(returnNode.typeName) : undefined;
        const returned =
          signatures.length === 1 && signatures[0] !== undefined
            ? checker.getReturnTypeOfSignature(signatures[0])
            : undefined;
        const actualResultSymbol = returned?.aliasSymbol ?? returned?.symbol;
        const actualResultIdentity = returned === undefined ? null : contractIdentity(returned);
        const resultType =
          resultDeclaration !== undefined &&
          (ts.isInterfaceDeclaration(resultDeclaration) || ts.isTypeAliasDeclaration(resultDeclaration)) &&
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
          ...((target.flags & ts.SymbolFlags.Value) !== 0 &&
          acceptsBehaviour(
            checker.getTypeOfSymbolAtLocation(target, declaration),
            (config.adapters ?? []).flatMap((adapter) =>
              adapter.kind === "external" && moduleFileOf(adapter.module, config.srcRoot, config.layerNames) === path
                ? (adapter.packages ?? [])
                : [],
            ),
          )
            ? { acceptsBehaviour: true as const }
            : {}),
        });
      }
    },
  };
}

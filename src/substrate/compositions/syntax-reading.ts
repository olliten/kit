import { basename } from "node:path";
import ts from "typescript";
import type { ProgramScope } from "../primitives/program-scope.js";

// What a node's syntax resolves to: the declaration it names, whether an import or export is type-only, the
// global or raw primitive it reaches, whether it is a literal, and the type identities an annotation names.
export function syntaxReading({ checker, local }: ProgramScope) {
  const targetOf = (node: ts.Node): ts.Declaration | undefined => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
      symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
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
  return { targetOf, typeOnlyOf, rawAccess, globalName, literal, annotation };
}

export type SyntaxReading = ReturnType<typeof syntaxReading>;

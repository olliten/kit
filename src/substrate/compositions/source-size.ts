import { join, relative, sep } from "node:path";
import ts from "typescript";
import type { SourceSize } from "../../core/primitives/file.js";

// A statement is counted wherever it is nested, except a block and an empty statement, which only group or
// punctuate. A statement whose every expression is a call, after any `await`, names the file that declares
// what it calls, as an import or re-export names the file it reaches; the compiler resolves both, so a file no
// project compiles names none.
export function sourceSize(
  path: string,
  text: string,
  program: ts.Program | undefined,
  appRoot: string,
  known: ReadonlySet<string>,
): SourceSize {
  const checker = program?.getTypeChecker();
  const source =
    program?.getSourceFile(join(appRoot, path)) ??
    ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false);
  const fileOf = (node: ts.Node | undefined): string | undefined => {
    if (checker === undefined || node === undefined) return undefined;
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
      symbol = checker.getAliasedSymbol(symbol);
    const homes = new Set(
      (symbol?.declarations ?? []).map((declaration) => declaration.getSourceFile()),
    );
    const [home] = homes;
    if (homes.size !== 1 || home === undefined || home.isDeclarationFile) return undefined;
    const file = relative(appRoot, home.fileName).split(sep).join("/");
    return known.has(file) && file !== path ? file : undefined;
  };
  const called = (expression: ts.Expression | undefined): string | undefined => {
    let inner = expression;
    while (inner !== undefined && (ts.isAwaitExpression(inner) || ts.isParenthesizedExpression(inner)))
      inner = inner.expression;
    if (inner === undefined || !(ts.isCallExpression(inner) || ts.isNewExpression(inner))) return undefined;
    const callee = inner.expression;
    if (ts.isIdentifier(callee)) return fileOf(callee);
    return ts.isPropertyAccessExpression(callee) ? fileOf(callee.name) : undefined;
  };
  const targetOf = (statement: ts.Statement): string | undefined => {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      return fileOf(statement.moduleSpecifier);
    if (ts.isReturnStatement(statement)) return called(statement.expression);
    if (ts.isExpressionStatement(statement)) {
      const expression = statement.expression;
      return ts.isBinaryExpression(expression) &&
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? called(expression.right)
        : called(expression);
    }
    if (ts.isVariableStatement(statement)) {
      const [declaration, ...more] = statement.declarationList.declarations;
      return more.length === 0 ? called(declaration?.initializer) : undefined;
    }
    return undefined;
  };
  let statements = 0;
  const calls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (!ts.isBlock(node) && !ts.isEmptyStatement(node) && ts.isStatement(node)) {
      statements++;
      const target = targetOf(node);
      if (target !== undefined) calls.push(target);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { file: path, statements, calls };
}

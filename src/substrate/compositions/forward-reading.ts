import ts from "typescript";

// A file forwards when it defines nothing of its own: every statement re-exports, through `export … from`,
// `export * from` or an imported binding exported again, or is an import whose every binding the file exports
// again. An import that keeps a binding for itself, a bare `import "./x.js"` that runs a module, a declaration
// of any kind, types included, or a call is the file's own, and an empty file forwards nothing. The answer is
// each re-exported module's specifier, which the caller resolves.
export function forwardedSpecifiers(source: ts.SourceFile): ts.Expression[] | undefined {
  const bound = new Map<string, ts.Expression>();
  const bindings = new Map<ts.ImportDeclaration, string[]>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    const names = [
      ...(clause?.name === undefined ? [] : [clause.name.text]),
      ...(clause?.namedBindings === undefined
        ? []
        : ts.isNamespaceImport(clause.namedBindings)
          ? [clause.namedBindings.name.text]
          : clause.namedBindings.elements.map((element) => element.name.text)),
    ];
    for (const name of names) bound.set(name, statement.moduleSpecifier);
    bindings.set(statement, names);
  }
  const exported = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause))
      for (const element of statement.exportClause.elements) exported.add((element.propertyName ?? element.name).text);
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) exported.add(statement.expression.text);
  }
  const forwarded: ts.Expression[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const names = bindings.get(statement) ?? [];
      if (names.length === 0 || !names.every((name) => exported.has(name))) return undefined;
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier !== undefined) {
        forwarded.push(statement.moduleSpecifier);
        continue;
      }
      const clause = statement.exportClause;
      if (clause === undefined || !ts.isNamedExports(clause)) return undefined;
      for (const element of clause.elements) {
        const target = bound.get((element.propertyName ?? element.name).text);
        if (target === undefined) return undefined;
        forwarded.push(target);
      }
      continue;
    }
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      const target = bound.get(statement.expression.text);
      if (target === undefined) return undefined;
      forwarded.push(target);
      continue;
    }
    return undefined;
  }
  return forwarded.length === 0 ? undefined : forwarded;
}

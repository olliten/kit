import ts from "typescript";

// A file forwards when it defines nothing of its own: every statement imports names or re-exports, through
// `export … from`, `export * from` or an imported binding exported again, and at least one re-exports. A bare
// `import "./x.js"` runs that module, so like a declaration or a call it is the file's own and the file
// forwards nothing. The answer is each re-exported module's specifier, which the caller resolves.
export function forwardedSpecifiers(source: ts.SourceFile): ts.Expression[] | undefined {
  const bound = new Map<string, ts.Expression>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name !== undefined) bound.set(clause.name.text, statement.moduleSpecifier);
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) bound.set(bindings.name.text, statement.moduleSpecifier);
      if (bindings !== undefined && ts.isNamedImports(bindings))
        for (const element of bindings.elements) bound.set(element.name.text, statement.moduleSpecifier);
    }
    if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference))
      bound.set(statement.name.text, statement.moduleReference.expression);
  }
  const forwarded: ts.Expression[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause === undefined) return undefined;
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) {
      const exported = ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export;
      if (exported !== 0) forwarded.push(statement.moduleReference.expression);
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

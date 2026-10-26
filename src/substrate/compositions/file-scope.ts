import ts from "typescript";

// One checked source file as its recorders see it: its path, and the site key of a node there. A site key is
// the node's enclosing named declarations and its own tokens, with an occurrence count among identical ones,
// so it survives edits elsewhere in the file.
export interface FileScope {
  readonly sf: ts.SourceFile;
  readonly path: string;
  readonly syntaxOf: (node: ts.Node) => readonly (readonly [string, string])[];
  readonly site: (node: ts.Node, kind: string, syntax?: unknown) => string;
}

export function fileScope(sf: ts.SourceFile, path: string): FileScope {
  const occurrences = new Map<string, number>();
  const syntaxOf = (node: ts.Node): readonly (readonly [string, string])[] => {
    const tokens: [string, string][] = [];
    const visitToken = (child: ts.Node): void => {
      if (ts.isJSDoc(child)) return;
      const children = child.getChildren(sf);
      if (children.length === 0) tokens.push([ts.SyntaxKind[child.kind], child.getText(sf)]);
      else for (const nested of children) visitToken(nested);
    };
    visitToken(node);
    return tokens;
  };
  const site = (node: ts.Node, kind: string, syntax: unknown = syntaxOf(node)): string => {
    const scope: (readonly [string, readonly (readonly [string, string])[]])[] = [];
    for (let parent: ts.Node | undefined = node.parent; parent !== undefined; parent = parent.parent) {
      const name =
        ts.isVariableDeclaration(parent) ||
        ts.isBindingElement(parent) ||
        ts.isFunctionDeclaration(parent) ||
        ts.isFunctionExpression(parent) ||
        ts.isClassDeclaration(parent) ||
        ts.isClassExpression(parent) ||
        ts.isInterfaceDeclaration(parent) ||
        ts.isTypeAliasDeclaration(parent) ||
        ts.isTypeParameterDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isMethodSignature(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent) ||
        ts.isEnumDeclaration(parent) ||
        ts.isEnumMember(parent) ||
        ts.isModuleDeclaration(parent)
          ? parent.name
          : undefined;
      if (name !== undefined) scope.unshift([ts.SyntaxKind[parent.kind], syntaxOf(name)]);
    }
    const identity = JSON.stringify([kind, scope, syntax]);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return JSON.stringify([scope, syntax, occurrence]);
  };
  return { sf, path, syntaxOf, site };
}

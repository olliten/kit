import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import type { FileScope } from "./file-scope.js";

type Project = CompilerFacts["projects"][number];

// The name a runtime reports for a function with a body: its own, or the binding, property or method it is
// assigned to. A function without one is anonymous and belongs to the named function that holds it.
function nameOf(node: ts.Node): string | null {
  if (!ts.isFunctionLike(node) || !("body" in node) || node.body === undefined) return null;
  if (ts.isConstructorDeclaration(node)) return null;
  const own = (name: ts.PropertyName | ts.BindingName | undefined): string | null =>
    name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name))
      ? name.text
      : null;
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return own(node.name);
  if (ts.isGetAccessorDeclaration(node)) return own(node.name) === null ? null : `get ${own(node.name)}`;
  if (ts.isSetAccessorDeclaration(node)) return own(node.name) === null ? null : `set ${own(node.name)}`;
  if (ts.isFunctionExpression(node) && node.name !== undefined) return node.name.text;
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === node) return own(parent.name);
    if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.initializer === node)
      return own(parent.name);
  }
  return null;
}

// The named functions of each checked source, each with an id unique in its file: the names of the named
// functions holding it, then its own, numbered when a file repeats it. Its lines are its body's span, so what
// it holds, anonymous or named, counts toward it.
export function functionRecorder() {
  const functions: NonNullable<Project["functions"]>[number][] = [];
  let ids = new Map<ts.Node, string>();
  let seen = new Map<string, number>();
  return {
    functions,
    visit({ sf, path }: FileScope, node: ts.Node): void {
      const name = nameOf(node);
      if (name === null) return;
      let holder: string | null = null;
      for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
        const known = ids.get(parent);
        if (known !== undefined) {
          holder = known;
          break;
        }
      }
      const base = holder === null ? name : `${holder}.${name}`;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      const id = count === 1 ? base : `${base}#${count}`;
      ids.set(node, id);
      const body =
        (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isAccessor(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)
          ? node.body
          : undefined) ?? node;
      const opens = sf.getLineAndCharacterOfPosition(body.getStart(sf)).line;
      const closes = sf.getLineAndCharacterOfPosition(body.getEnd()).line;
      functions.push({
        file: path,
        name,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        id,
        holder,
        lines: closes - opens + 1,
      });
    },
    end(): void {
      ids = new Map();
      seen = new Map();
    },
  };
}

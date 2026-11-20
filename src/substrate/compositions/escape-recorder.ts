import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import type { FileScope } from "./file-scope.js";

type Project = CompilerFacts["projects"][number];

// The escape hatches in checked code: `any`, a type assertion other than `as const`, a non-null assertion
// other than on an indexed access, and a compiler directive comment, each keyed by its site. Given the checker,
// an assertion also records the top-level declaration holding it, the branded type it produces when that is the
// holder's declared result, and whether a runtime check of its value rejects other values before it.
export function escapeRecorder(types?: { readonly checker: ts.TypeChecker; readonly local: (fileName: string) => string }) {
  const escapes: Project["escapes"][number][] = [];
  let comments = new Map<number, ts.CommentRange>();
  return {
    escapes,
    visit({ sf, path, site }: FileScope, node: ts.Node): void {
      for (const comment of [
        ...(ts.getLeadingCommentRanges(sf.text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(sf.text, node.end) ?? []),
      ])
        comments.set(comment.pos, comment);
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
      if (kind === null) return;
      const escape: Project["escapes"][number] = { file: path, start: node.getStart(sf), kind, site: site(node, kind) };
      escapes.push(
        kind === "assertion" && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
          ? { ...escape, ...refinement(node, types) }
          : escape,
      );
    },
    end({ sf, path, site, syntaxOf }: FileScope): void {
      for (const comment of comments.values()) {
        for (const match of sf.text.slice(comment.pos, comment.end).matchAll(/@ts-(ignore|nocheck|expect-error)\b/g)) {
          const kind = match[1];
          if (kind === "ignore" || kind === "nocheck" || kind === "expect-error") {
            let target: ts.Node = sf;
            const following = (node: ts.Node): void => {
              if (node.getFullStart() <= comment.pos && node.end >= comment.end) {
                target = node;
                if (!ts.isSourceFile(node) && node.getStart(sf) >= comment.end) return;
                ts.forEachChild(node, following);
              }
            };
            if (kind !== "nocheck") following(sf);
            escapes.push({
              file: path,
              start: comment.pos + match.index,
              kind,
              site: site(target, kind, [
                sf.text.slice(comment.pos, comment.end).replace(/\s+/g, " ").trim(),
                ts.isSourceFile(target) ? [] : syntaxOf(target),
              ]),
            });
          }
        }
      }
      comments = new Map();
    },
  };
}

type Assertion = ts.AsExpression | ts.TypeAssertion;
type Holder = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

// What makes an assertion a refinement: the top-level declaration holding it, the branded type it produces when
// that is the holding function's declared result, and whether a rejecting check of its value comes first.
function refinement(
  node: Assertion,
  types: { readonly checker: ts.TypeChecker; readonly local: (fileName: string) => string } | undefined,
): { holder?: string; brand?: { file: string; name: string }; checked?: true } {
  let top: ts.Node = node;
  while (top.parent !== undefined && !ts.isSourceFile(top.parent)) top = top.parent;
  const declared = ts.isVariableStatement(top) ? top.declarationList.declarations[0] : undefined;
  const fn: Holder | undefined = ts.isFunctionDeclaration(top)
    ? top
    : declared?.initializer !== undefined &&
        (ts.isArrowFunction(declared.initializer) || ts.isFunctionExpression(declared.initializer))
      ? declared.initializer
      : undefined;
  const name = ts.isFunctionDeclaration(top) ? top.name?.text : declared !== undefined && ts.isIdentifier(declared.name) ? declared.name.text : undefined;
  if (name === undefined) return {};
  const brand = fn !== undefined && types !== undefined ? brandOf(node, fn, types) : undefined;
  return { holder: name, ...(brand === undefined ? {} : { brand }), ...(fn !== undefined && checkedBefore(node, fn) ? { checked: true } : {}) };
}

// The asserted type, when it is the holder's declared result or one of its alternatives and intersects a base type with a brand member: an
// object type each of whose properties is readonly and holds a literal or unique symbol, which no plain value has.
function brandOf(
  node: Assertion,
  fn: Holder,
  { checker, local }: { readonly checker: ts.TypeChecker; readonly local: (fileName: string) => string },
): { file: string; name: string } | undefined {
  if (fn.type === undefined) return undefined;
  const asserted = checker.getTypeFromTypeNode(node.type);
  const result = checker.getTypeFromTypeNode(fn.type);
  const produced = asserted === result || (result.isUnion() && result.types.includes(asserted));
  if (!produced || !asserted.isIntersection()) return undefined;
  const branded = asserted.types.some(
    (part) =>
      (part.flags & ts.TypeFlags.Object) !== 0 &&
      part.getProperties().length > 0 &&
      part.getProperties().every((property) => {
        const declaration = property.valueDeclaration;
        const literal = checker.getTypeOfSymbol(property).flags & (ts.TypeFlags.Literal | ts.TypeFlags.UniqueESSymbol);
        return (
          declaration !== undefined &&
          ts.isPropertySignature(declaration) &&
          (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0 &&
          literal !== 0
        );
      }),
  );
  const symbol = asserted.aliasSymbol ?? (ts.isTypeReferenceNode(node.type) ? checker.getSymbolAtLocation(node.type.typeName) : undefined);
  const home = symbol?.declarations?.[0];
  return branded && symbol !== undefined && home !== undefined
    ? { file: local(home.getSourceFile().fileName), name: symbol.getName() }
    : undefined;
}

// Whether a runtime check of the asserted value guards the assertion inside its holder: an earlier `if` on the
// value whose branch throws or returns, or an `if` or conditional on the value whose taken branch holds it.
function checkedBefore(node: Assertion, fn: Holder): boolean {
  const names = new Set<string>();
  const collect = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) names.add(child.text);
    ts.forEachChild(child, collect);
  };
  collect(node.expression);
  const mentions = (condition: ts.Expression): boolean => {
    let found = false;
    const look = (child: ts.Node): void => {
      if (ts.isIdentifier(child) && names.has(child.text)) found = true;
      else ts.forEachChild(child, look);
    };
    look(condition);
    return found;
  };
  const rejects = (statement: ts.Statement): boolean => {
    const last = ts.isBlock(statement) ? statement.statements[statement.statements.length - 1] : statement;
    return last !== undefined && (ts.isThrowStatement(last) || ts.isReturnStatement(last));
  };
  for (let child: ts.Node = node; child.parent !== undefined && child !== fn; child = child.parent) {
    const parent = child.parent;
    if (ts.isIfStatement(parent) && child !== parent.expression && mentions(parent.expression)) return true;
    if (ts.isConditionalExpression(parent) && child !== parent.condition && mentions(parent.condition)) return true;
  }
  let guarded = false;
  const start = node.getStart();
  const scan = (child: ts.Node): void => {
    if (guarded || child.getStart() >= start) return;
    if (child !== fn && ts.isFunctionLike(child)) return;
    if (ts.isIfStatement(child) && child.end <= start && mentions(child.expression) && rejects(child.thenStatement)) guarded = true;
    else ts.forEachChild(child, scan);
  };
  if (fn.body !== undefined) ts.forEachChild(fn.body, scan);
  return guarded;
}

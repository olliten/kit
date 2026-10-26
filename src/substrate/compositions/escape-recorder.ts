import ts from "typescript";
import type { CompilerFacts } from "../../core/primitives/compiler-facts.js";
import type { FileScope } from "./file-scope.js";

type Project = CompilerFacts["projects"][number];

// The escape hatches in checked code: `any`, a type assertion other than `as const`, a non-null assertion
// other than on an indexed access, and a compiler directive comment, each keyed by its site.
export function escapeRecorder() {
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
      if (kind !== null) escapes.push({ file: path, start: node.getStart(sf), kind, site: site(node, kind) });
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

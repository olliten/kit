import type { Nodes, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { ClaimMarker } from "../primitives/claim.js";

export interface ClaimInventory {
  readonly declarations: readonly ClaimMarker[];
  readonly references: readonly ClaimMarker[];
}

export function claimInventory(
  text: string,
  options: {
    readonly separator?: string;
    readonly legacy?: boolean;
    readonly anchor?: string;
  } = {},
): ClaimInventory {
  const root = fromMarkdown(text);
  const declarations: ClaimMarker[] = [];
  const references: ClaimMarker[] = [];
  const declared = new Map<Text, number>();
  let legacyHeading: string | null = null;
  let headingMarkerConsumed = false;
  const pattern = options.anchor ?? "\\{#[\\w-]+\\}";
  const matches = (value: string): RegExpStringIterator<RegExpExecArray> =>
    value.matchAll(new RegExp(pattern, "g"));
  const marker = (node: Text, match: RegExpExecArray): ClaimMarker => ({
    anchor: match[0].slice(2, -1),
    line:
      (node.position?.start.line ?? 1) + node.value.slice(0, match.index).split("\n").length - 1,
  });
  const named = (node: Nodes): string[] =>
    node.type === "text"
      ? [...node.value.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => (match[1] ?? "").trim())
      : node.type !== "inlineCode" && "children" in node
        ? node.children.flatMap(named)
        : [];
  const close = (node: Nodes): void => {
    if (!("children" in node)) return;
    const tail = node.children.at(-1);
    if (tail?.type !== "text") return;
    const terms = [...new Set(named(node))];
    for (const match of matches(tail.value)) {
      if (tail.value.slice(match.index + match[0].length).trim() !== "") continue;
      declared.set(tail, match.index);
      const claim = terms.length === 0 ? marker(tail, match) : { ...marker(tail, match), terms };
      if (options.legacy && legacyHeading === claim.anchor && !headingMarkerConsumed)
        headingMarkerConsumed = true;
      else declarations.push(claim);
    }
  };
  const visit = (node: Nodes): void => {
    if (node.type === "code") return;
    if (node.type === "listItem") {
      const paragraph = options.legacy ? node.children[0] : node.children.at(-1);
      if (paragraph?.type === "paragraph") close(paragraph);
    }
    if (node.type === "heading") {
      legacyHeading = null;
      headingMarkerConsumed = false;
      close(node);
      if (options.legacy && options.separator !== undefined && node.depth === 3) {
        const value = node.children
          .map((child) => (child.type === "text" ? child.value : ""))
          .join("");
        const prefix = `law ${options.separator} `;
        const law = value.startsWith(prefix)
          ? /^([\w-]+)(?:\s+—\s+.*)?$/.exec(value.slice(prefix.length))
          : null;
        if (law?.[1]) {
          legacyHeading = law[1];
          if (
            !declarations.some(
              (claim) => claim.anchor === law[1] && claim.line === node.position?.start.line,
            )
          )
            declarations.push({ anchor: law[1], line: node.position?.start.line ?? 1 });
        }
      }
    }
    if (node.type === "text") {
      for (const match of matches(node.value)) {
        if (declared.get(node) !== match.index) references.push(marker(node, match));
      }
    }
    if (node.type === "inlineCode") {
      for (const match of matches(node.value)) {
        references.push({ anchor: match[0].slice(2, -1), line: node.position?.start.line ?? 1 });
      }
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(root);
  return { declarations, references };
}

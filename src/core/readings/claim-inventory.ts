import type { Nodes, Table, TableRow, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTable } from "micromark-extension-gfm-table";
import type { ClaimMarker } from "../primitives/claim.js";

export interface ClaimInventory {
  readonly declarations: readonly ClaimMarker[];
  readonly references: readonly ClaimMarker[];
}

export const claimMarkdown = (text: string) =>
  fromMarkdown(text, { extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()] });

const moduleNames = (value: string): readonly string[] | null => {
  if (!/^\{\{[^{}\\]+\}\}(?:\s*,\s*\{\{[^{}\\]+\}\})*\s*$/.test(value)) return null;
  const terms = [...value.matchAll(/\{\{([^{}]+)\}\}/g)].map((term) => (term[1] ?? "").trim());
  if (terms.some((term) => !term) ||
      new Set(terms.map((term) => term.toLowerCase())).size !== terms.length) return null;
  return terms;
};

export function tableModules(
  table: Table,
  row: TableRow,
  text: string,
  anchor: string,
  separator = "·",
): Pick<ClaimMarker, "implementation" | "proof"> | null {
  const roles: { implementation?: readonly string[]; proof?: readonly string[] } = {};
  const seen = new Set<string>();
  for (const [index, cell] of (table.children[0]?.children ?? []).entries()) {
    const label =
      cell.children.length === 1 && cell.children[0]?.type === "text"
        ? cell.children[0].value.trim()
        : "";
    if (label !== "Implementation" && label !== "Proof") continue;
    if (seen.has(label)) return null;
    seen.add(label);
    const valueCell = row.children[index];
    if (valueCell === undefined) continue;
    if (valueCell.children.some((child) => child.type !== "text")) return null;
    if (valueCell.children.length === 0) continue;
    const start = valueCell.children[0]?.position?.start.offset;
    const end = valueCell.children.at(-1)?.position?.end.offset;
    if (start === undefined || end === undefined) return null;
    let value = text.slice(start, end).trim();
    if (index === row.children.length - 1) {
      value = value.replace(new RegExp(`${anchor}\\s*$`), "").trim();
      if (separator && value.endsWith(separator)) value = value.slice(0, -separator.length).trim();
    }
    if (!value) continue;
    const terms = moduleNames(value);
    if (terms === null) return null;
    roles[label === "Implementation" ? "implementation" : "proof"] = terms;
  }
  return roles;
}

// Only these two exact metadata rows may follow a claim's closing paragraph. They describe
// relationships to modules, independently of where those modules live.
export function claimModules(node: Nodes, text: string): Pick<ClaimMarker, "implementation" | "proof"> | null {
  if (node.type !== "listItem" || node.children.length !== 2) return null;
  const [paragraph, list] = node.children;
  if (paragraph?.type !== "paragraph" || list?.type !== "list" || list.ordered) return null;
  const roles: { implementation?: readonly string[]; proof?: readonly string[] } = {};
  for (const item of list.children) {
    const row = item.children[0];
    if (
      item.children.length !== 1 ||
      row?.type !== "paragraph" ||
      row.children.some((child) => child.type !== "text")
    )
      return null;
    const start = row.position?.start.offset;
    const end = row.position?.end.offset;
    if (start === undefined || end === undefined) return null;
    // Reference resolution uses literal source notation, not decoded escapes or HTML entities.
    const value = text.slice(start, end);
    const match = /^(Implementation|Proof):\s*(\{\{[^{}\\]+\}\}(?:\s*,\s*\{\{[^{}\\]+\}\})*)\s*$/.exec(
      value,
    );
    if (match === null) return null;
    const role = match[1] === "Implementation" ? "implementation" : "proof";
    const terms = moduleNames(match[2] ?? "");
    if (roles[role] !== undefined || terms === null) return null;
    roles[role] = terms;
  }
  return list.children.length === 0 ? null : roles;
}

export function claimInventory(
  text: string,
  options: {
    readonly separator?: string;
    readonly legacy?: boolean;
    readonly anchor?: string;
  } = {},
): ClaimInventory {
  const root = claimMarkdown(text);
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
  const close = (
    node: Nodes,
    modules: Pick<ClaimMarker, "implementation" | "proof"> = {},
    promise: Nodes = node,
  ): void => {
    if (!("children" in node)) return;
    const tail = node.children.at(-1);
    if (tail?.type !== "text") return;
    const terms = [
      ...new Set([...named(promise), ...(modules.implementation ?? []), ...(modules.proof ?? [])]),
    ];
    for (const match of matches(tail.value)) {
      if (tail.value.slice(match.index + match[0].length).trim() !== "") continue;
      declared.set(tail, match.index);
      const claim =
        terms.length === 0 ? marker(tail, match) : { ...marker(tail, match), terms, ...modules };
      if (options.legacy && legacyHeading === claim.anchor && !headingMarkerConsumed)
        headingMarkerConsumed = true;
      else declarations.push(claim);
    }
  };
  const visit = (node: Nodes): void => {
    if (node.type === "code") return;
    if (node.type === "table") {
      for (const row of node.children.slice(1)) {
        const cell = row.children.at(-1);
        if (cell !== undefined)
          close(cell, tableModules(node, row, text, pattern, options.separator) ?? {}, row);
      }
    }
    if (node.type === "listItem") {
      const modules = claimModules(node, text);
      const paragraph =
        options.legacy || modules !== null ? node.children[0] : node.children.at(-1);
      if (paragraph?.type === "paragraph") close(paragraph, modules ?? {});
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

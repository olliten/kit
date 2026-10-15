import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { SpecTerm, TermSyntaxIssue } from "../primitives/term.js";

export function termInventory(text: string): {
  readonly terms: readonly SpecTerm[];
  readonly prose: string;
  readonly issues: readonly TermSyntaxIssue[];
  readonly order: readonly TermSyntaxIssue[];
} {
  const terms: SpecTerm[] = [];
  const issues: TermSyntaxIssue[] = [];
  const order: TermSyntaxIssue[] = [];
  const ranges: [number, number][] = [];
  const plain = (node: Nodes): string =>
    node.type === "text" || node.type === "inlineCode"
      ? node.value
      : "children" in node
        ? node.children.map(plain).join("")
        : "";
  // Each list of terms is alphabetical, so agents adding different terms at once edit different lines.
  const sorted = (list: Nodes): void => {
    if (list.type !== "list") return;
    let previous = "";
    for (const item of list.children) {
      const paragraph = item.children[0];
      const first = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
      if (first?.type !== "strong") continue;
      const term = plain(first);
      if (term.toLowerCase() < previous.toLowerCase())
        order.push({
          term,
          line: item.position?.start.line ?? 1,
          detail: `Place ${term} in alphabetical order, before ${previous}.`,
        });
      previous = term;
    }
  };
  const visit = (node: Nodes): void => {
    if (node.type === "code" || node.type === "inlineCode") return;
    sorted(node);
    if (node.type === "listItem") {
      const paragraph = node.children[0];
      const first = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
      if (first?.type === "strong" && paragraph?.type === "paragraph") {
        const tail = paragraph.children.slice(1).map(plain).join("");
        if (/^\s+—\s+/.test(tail)) {
          const term = plain(first);
          const line = node.position?.start.line ?? 1;
          const body = tail.replace(/^\s+—\s+/, "").replace(/\s+/g, " ");
          const retired = /\s+Retired: (.*?)\.?$/.exec(body);
          const keys = new Map<string, string>();
          const declarationIssues: TermSyntaxIssue[] = [];
          const fail = (detail: string): void => {
            declarationIssues.push({ term, line, detail });
          };
          for (const list of node.children.slice(1)) {
            if (list.type !== "list") {
              fail("Use one directly nested metadata list.");
              continue;
            }
            for (const item of list.children) {
              const value =
                item.children.length === 1 && item.children[0]?.type === "paragraph"
                  ? plain(item.children[0])
                  : "";
              const match = /^(Role|Zone|From|Of|Field|Type|Plain):\s*(.+)$/.exec(value);
              if (!match || !match[1] || !match[2]) {
                fail("Use a supported metadata key and value.");
                continue;
              }
              if (keys.has(match[1])) fail(`Declare ${match[1]} once.`);
              keys.set(match[1], match[2]);
            }
          }
          let metadata: SpecTerm["metadata"];
          if (keys.size > 0 && declarationIssues.length === 0) {
            if (keys.has("Role")) {
              const role = keys.get("Role");
              const zone = keys.get("Zone");
              const key = role === "derived" ? "From" : "Of";
              const list = keys.get(key) ?? "";
              const entries = list === "[]" ? [] : list.split(/\s*,\s*/);
              const references = entries.flatMap((entry) => {
                const match = /^\{\{([^{}]+)\}\}$/.exec(entry);
                return match?.[1] ? [match[1]] : [];
              });
              const legacySources = entries.filter((entry) =>
                /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)+[A-Za-z0-9_-][A-Za-z0-9_.-]*\.[cm]?[jt]sx?$/.test(
                  entry,
                ),
              );
              if (
                !(
                  role === "fact" ||
                  role === "derived" ||
                  role === "adapter" ||
                  role === "composition"
                ) ||
                !(zone === "core" || zone === "shell" || zone === "substrate") ||
                keys.size !== 3 ||
                !(list === "[]" || entries.length === references.length + legacySources.length)
              ) {
                fail("Declare Role, Zone and the matching From or Of list.");
              } else
                metadata = {
                  kind: "module",
                  role,
                  zone,
                  references,
                  ...(legacySources.length > 0 ? { legacySources } : {}),
                };
            } else if (keys.has("Field")) {
              const field = /^([^:]+)::([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(
                keys.get("Field") ?? "",
              );
              const type = /^([^:]+)::([A-Za-z_$][\w$]*)(\s*\|\s*(?:undefined|null))*$/.exec(
                keys.get("Type") ?? "",
              );
              if (
                keys.size !== 2 ||
                !field?.[1] ||
                !field[2] ||
                !field[3] ||
                !type?.[1] ||
                !type[2]
              ) {
                fail("Declare one Field slot and one named Type with explicit permitted absence.");
              } else {
                const absence = [
                  ...(keys.get("Type") ?? "").matchAll(/\|\s*(undefined|null)/g),
                ].flatMap((m): ("undefined" | "null")[] =>
                  m[1] === "undefined" || m[1] === "null" ? [m[1]] : [],
                );
                if (new Set(absence).size !== absence.length)
                  fail("Declare each absence member once.");
                else
                  metadata = {
                    kind: "field",
                    owner: field[1],
                    declaration: field[2],
                    property: field[3],
                    typeOwner: type[1],
                    typeName: type[2],
                    absence,
                  };
              }
            } else {
              const scalar = keys.get("Plain");
              if (
                keys.size !== 1 ||
                !(scalar === "string" || scalar === "number" || scalar === "boolean")
              )
                fail("Declare exactly one supported Plain scalar.");
              else metadata = { kind: "plain", scalar };
            }
          }
          terms.push({
            term,
            meaning: retired ? body.slice(0, retired.index) : body,
            retired:
              retired?.[1]
                ?.replace(/\.$/, "")
                .split(",")
                .map((s) => s.trim()) ?? [],
            line,
            ...(declarationIssues.length === 0 && metadata ? { metadata } : {}),
          });
          issues.push(...declarationIssues);
          if (node.position?.start.offset !== undefined && node.position.end.offset !== undefined)
            ranges.push([node.position.start.offset, node.position.end.offset]);
          return;
        }
      }
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(fromMarkdown(text));
  let prose = text;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0]))
    prose =
      prose.slice(0, start) + prose.slice(start, end).replace(/[^\n]/g, " ") + prose.slice(end);
  return { terms, prose, issues, order };
}

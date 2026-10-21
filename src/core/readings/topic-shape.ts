import type { Nodes, Root } from "mdast";
import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { claimMarkdown, claimModules, tableModules } from "./claim-inventory.js";

// A topic has one shape, so a requirement has nowhere to hide but a claim, and every claim is tested.
const INTRO_SENTENCES = 3;

const textOf = (node: Nodes): string =>
  node.type === "text"
    ? node.value
    : node.type === "inlineCode"
      ? "code"
      : "children" in node
        ? node.children.map(textOf).join("")
        : "";

const sentences = (text: string): number =>
  (text.replace(/\b(?:e\.g|i\.e|etc|vs)\./g, "").match(/[.!?](?:\s|$)/g) ?? []).length;

export function topicShape(snapshot: Snapshot): Finding[] {
  const { termsFile, legacyAreas, anchor, claimSeparator } = snapshot.config;
  const closes = new RegExp(`${anchor}\\s*$`);
  const findings: Finding[] = [];
  for (const { file, text } of snapshot.prose) {
    const name = file.split("/").at(-1) ?? "";
    if (file === termsFile || legacyAreas?.includes(file) || name === "README.md")
      continue;
    const root: Root = claimMarkdown(text);
    const add = (node: Nodes | undefined, fix: string): void => {
      findings.push(finding("R4", "topic-shape", file, fix, String(node?.position?.start.line ?? 1)));
    };
    const [title, ...rest] = root.children;
    if (title?.type !== "heading" || title.depth !== 1) {
      add(title, "Start the topic with one `# ` title.");
      continue;
    }
    let index = 0;
    let intro = 0;
    for (let lead = rest[index]; lead?.type === "paragraph"; lead = rest[++index])
      intro += sentences(textOf(lead));
    if (intro > INTRO_SENTENCES)
      add(rest[0], `Shorten the intro to at most ${INTRO_SENTENCES} sentences; state each requirement as a claim.`);
    for (; index < rest.length; index++) {
      const node = rest[index];
      if (node === undefined) continue;
      if (node.type === "heading" && node.depth === 2) continue;
      if (node.type === "heading")
        add(
          node,
          node.depth === 3
            ? "Define this module in the terms file and name it in the claims it keeps; a topic has no module headings."
            : "Use `## ` for a section; a topic has no deeper headings.",
        );
      if (node.type === "heading") continue;
      if (node.type === "table") {
        const header = node.children[0];
        if (header?.children.some((cell) => !textOf(cell).trim()))
          add(header, "Name each field in the claim table header.");
        const roles = header?.children.map(textOf).filter((label) =>
          label === "Implementation" || label === "Proof") ?? [];
        if (new Set(roles).size !== roles.length)
          add(header, "Use at most one Implementation column and one Proof column.");
        for (const row of node.children.slice(1)) {
          const final = row.children.at(-1);
          const markers = row.children.flatMap((cell) =>
            [...textOf(cell).matchAll(new RegExp(anchor, "g"))]);
          if (
            row.children.length !== header?.children.length ||
            final === undefined || final.children.at(-1)?.type !== "text" ||
            markers.length !== 1 || !closes.test(textOf(final)) ||
            tableModules(node, row, text, anchor, claimSeparator) === null
          )
            add(row, "State one claim per table row, close its final cell with one anchor, and use only module references in Implementation and Proof columns.");
        }
        continue;
      }
      if (node.type === "list") {
        for (const item of node.children) {
          const [paragraph, ...more] = item.children;
          if (
            paragraph?.type !== "paragraph" ||
            (more.length > 0 && claimModules(item, text) === null) ||
            !closes.test(textOf(paragraph))
          )
            add(
              item,
              "Close the claim paragraph with its anchor; only Implementation and Proof module-reference rows may follow it.",
            );
        }
        continue;
      }
      add(
        node,
        node.type === "paragraph"
          ? "Move this prose into a claim, or into the intro."
          : "A topic holds only headings and claims; move this into a claim or out of the topic.",
      );
    }
  }
  return findings.sort(byDebtKey);
}

import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { claimModules } from "./claim-inventory.js";

// A topic has one shape, so a requirement has nowhere to hide but a claim, and every claim is tested.
// The shape: a title, an intro of at most three sentences, then only section headings and lists whose
// every item is a claim. Modules are defined in the terms file and named by the claims they keep. Spec
// files that are not topics are the terms file, configured legacy areas, and a README.
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
  const { termsFile, legacyAreas, anchor } = snapshot.config;
  const closes = new RegExp(`${anchor}\\s*$`);
  const findings: Finding[] = [];
  for (const { file, text } of snapshot.prose) {
    const name = file.split("/").at(-1) ?? "";
    if (file === termsFile || legacyAreas?.includes(file) || name === "README.md")
      continue;
    const root: Root = fromMarkdown(text);
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
      if (node.type === "list") {
        for (const item of node.children) {
          const [paragraph, ...more] = item.children;
          if (
            paragraph?.type !== "paragraph" ||
            (more.length > 0 && claimModules(item) === null) ||
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

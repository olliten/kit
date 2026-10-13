import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Reference, SemanticReference } from "../primitives/reference.js";
import type { Topic } from "../primitives/topic.js";
import { type Finding, byDebtKey, finding } from "./finding.js";

export interface SemanticReferenceInventory {
  readonly title: string | null;
  readonly references: readonly SemanticReference[];
}

export interface ResolvedSemanticReference extends Reference {
  readonly target: string | null;
}

export interface SemanticReferences {
  readonly findings: readonly Finding[];
  readonly references: readonly ResolvedSemanticReference[];
  readonly topics: readonly Topic[];
  readonly incomingTopics: readonly { readonly topic: string; readonly from: readonly string[] }[];
  readonly topicModules: readonly { readonly topic: string; readonly modules: readonly string[] }[];
}

export function semanticReferenceInventory(text: string): SemanticReferenceInventory {
  const references: SemanticReference[] = [];
  let title: string | null = null;
  const plain = (node: Nodes): string =>
    node.type === "text" || node.type === "inlineCode"
      ? node.value
      : "children" in node
        ? node.children.map(plain).join("")
        : "";
  const visit = (node: Nodes): void => {
    if (node.type === "code" || node.type === "inlineCode") return;
    if (node.type === "heading" && node.depth === 1 && title === null) title = plain(node);
    if (node.type === "text") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const raw = text.slice(start, end);
      for (const match of raw.matchAll(/\[\[([^\[\]]+)\]\]|\{\{([^{}]+)\}\}/g)) {
        const before = raw.slice(0, match.index);
        const escapes = /\\+$/.exec(before)?.[0].length ?? 0;
        const value = match[1] ?? match[2] ?? "";
        const closingEscapes = /\\+$/.exec(value)?.[0].length ?? 0;
        if (escapes % 2 !== 0 || closingEscapes % 2 !== 0) continue;
        const name = value.trim().replace(/\s+/g, " ");
        if (name === "") continue;
        references.push({
          namespace: match[1] === undefined ? "term" : "topic",
          name,
          line: (node.position?.start.line ?? 1) + before.split("\n").length - 1,
        });
      }
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(fromMarkdown(text));
  return { title, references };
}

function identity(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function semanticReferences(snapshot: Snapshot): SemanticReferences {
  const findings: Finding[] = [];
  const topics: Topic[] = [];
  const indexes = {
    topic: new Map<string, Set<string>>(),
    term: new Map<string, Set<string>>(),
  };
  const add = (namespace: "topic" | "term", name: string, target: string): void => {
    const key = identity(name);
    const targets = indexes[namespace].get(key) ?? new Set<string>();
    targets.add(target);
    indexes[namespace].set(key, targets);
  };
  const inventories = snapshot.prose.map(({ file, text }) => ({
    file,
    ...semanticReferenceInventory(text),
  }));
  for (const { file } of inventories) {
    if (file === snapshot.config.termsFile) continue;
    const stem = file.slice(file.lastIndexOf("/") + 1).replace(/\.md$/, "");
    topics.push({ file, name: stem });
    add("topic", stem, file);
  }
  for (const { term, line } of snapshot.terms)
    add("term", term, `${snapshot.config.termsFile}:${line}`);
  const markers =
    snapshot.semanticReferences ??
    inventories.flatMap(({ file, references }) =>
      references.map((reference) => ({ ...reference, file })),
    );
  const references = markers.map((reference): ResolvedSemanticReference => {
    const targets = [...(indexes[reference.namespace].get(identity(reference.name)) ?? [])];
    if (targets.length !== 1) {
      const problem = targets.length === 0 ? "missing" : "ambiguous";
      findings.push(
        finding(
          "R3",
          `${problem}-${reference.namespace}-reference`,
          reference.file,
          targets.length === 0
            ? `Define the ${reference.namespace} ${reference.name}, or correct its marked reference on line ${reference.line}.`
            : `Give ${reference.namespace} ${reference.name} one definition; its marked reference on line ${reference.line} matches ${targets.join(", ")}.`,
          identity(reference.name),
        ),
      );
    }
    return { ...reference, target: targets.length === 1 ? (targets[0] ?? null) : null };
  });
  const incomingTopics = topics.map(({ file }): { topic: string; from: readonly string[] } => ({
    topic: file,
    from: [
      ...new Set(
        references
          .filter((ref) => ref.namespace === "topic" && ref.target === file)
          .map((ref) => ref.file),
      ),
    ].sort(),
  }));
  const moduleTerms = new Map(
    snapshot.terms
      .filter((term) => term.metadata?.kind === "module")
      .map((term) => [`${snapshot.config.termsFile}:${term.line}`, term.term]),
  );
  const topicModules = topics
    .map(({ file }): { topic: string; modules: readonly string[] } => ({
      topic: file,
      modules: [
        ...new Set(
          references.flatMap((reference) => {
            if (
              reference.file !== file ||
              reference.namespace !== "term" ||
              reference.target === null
            )
              return [];
            const term = moduleTerms.get(reference.target);
            return term === undefined ? [] : [term];
          }),
        ),
      ].sort(),
    }))
    .sort((left, right) => left.topic.localeCompare(right.topic));
  return {
    findings: [...new Map(findings.map((item) => [item.debtKey, item])).values()].sort(byDebtKey),
    references,
    topics,
    incomingTopics,
    topicModules,
  };
}

export function referenceCheck(snapshot: Snapshot): readonly Finding[] {
  return semanticReferences(snapshot).findings;
}
import type { Snapshot } from "../primitives/snapshot.js";

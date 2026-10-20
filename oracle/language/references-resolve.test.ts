import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { claimInventory } from "../../src/core/readings/claim-inventory.js";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import {
  referenceCheck,
  semanticReferenceInventory,
  semanticReferences,
} from "../../src/core/readings/semantic-references.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { bindingFindings } from "../core/readings/binding-findings.js";

function snapshot(
  documents: Readonly<Record<string, string>>,
  terms: readonly string[] = [],
): Snapshot {
  return {
    files: Object.keys(documents).map((path) => ({ path, type: "spec" })),
    imports: [],
    terms: terms.map((term, index) => ({ term, meaning: "", retired: [], line: index + 1 })),
    prose: Object.entries(documents).map(([file, text]) => ({ file, text })),
    symbols: [],
    comments: [],
    config: DEFAULT_CONFIG,
  };
}

function readDocuments(documents: Readonly<Record<string, string>>): Snapshot {
  const root = mkdtempSync(join(tmpdir(), "kit-semantic-oracle-"));
  try {
    for (const [path, text] of Object.entries(documents)) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    return readSnapshot(root, DEFAULT_CONFIG);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("real extraction retains references on term definitions and their original source lines", () => {
  const actual = readDocuments({
    "spec/terms.md":
      "# Terms\n\n- **value** — A value from [[Planning]].\n\n- **result** — A {{value}} that follows {{missing}}.\n",
    "spec/planning.md": "# Planning\n",
  });
  const result = semanticReferences(actual);
  expect(result.references).toEqual([
    expect.objectContaining({
      file: "spec/terms.md",
      namespace: "topic",
      name: "Planning",
      line: 3,
      target: "spec/planning.md",
    }),
    expect.objectContaining({
      file: "spec/terms.md",
      namespace: "term",
      name: "value",
      line: 5,
      target: "spec/terms.md:3",
    }),
    expect.objectContaining({
      file: "spec/terms.md",
      namespace: "term",
      name: "missing",
      line: 5,
      target: null,
    }),
  ]);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.path).toBe("spec/terms.md");
});

test("real extraction preserves escaped examples rather than reparsing decoded Markdown text", () => {
  const actual = readDocuments({
    "spec/source.md": "# Source\n\\[[Example]] \\{{sample}} `[[Inline]]` {{value}}\n",
    "spec/terms.md": "# Terms\n- **value** — Supplied data.\n",
  });
  const result = semanticReferences(actual);
  expect(result.findings).toEqual([]);
  expect(result.references).toEqual([
    expect.objectContaining({
      file: "spec/source.md",
      name: "value",
      line: 2,
      target: "spec/terms.md:2",
    }),
  ]);
});

test("topic and term references with the same word resolve in separate namespaces", () => {
  const result = semanticReferences(
    snapshot(
      {
        "spec/billing.md": "# Billing\n\nThe word {{billing}} names this topic [[Billing]].\n",
      },
      ["billing"],
    ),
  );
  expect(result.findings).toEqual([]);
  expect(result.references).toEqual([
    expect.objectContaining({ namespace: "term", name: "billing", target: "spec/terms.md:1" }),
    expect.objectContaining({ namespace: "topic", name: "Billing", target: "spec/billing.md" }),
  ]);
});

test("a topic cannot satisfy a missing term and a term cannot satisfy a missing topic", () => {
  const result = semanticReferences(
    snapshot(
      {
        "spec/planning.md": "# Planning\n{{Planning}} and [[invoice]].\n",
      },
      ["invoice"],
    ),
  );
  expect(result.findings).toHaveLength(2);
  expect(result.references.every((reference) => reference.target === null)).toBe(true);
});

test("missing topic and term references each report their actual source path", () => {
  const result = referenceCheck(snapshot({ "spec/plan.md": "# Plan\n[[Absent]] {{missing}}\n" }));
  expect(result).toHaveLength(2);
  expect(result.every((finding) => finding.rule === "R3" && finding.path === "spec/plan.md")).toBe(
    true,
  );
});

test("a title and its filename identify one topic rather than two competing targets", () => {
  const result = semanticReferences(snapshot({ "spec/planning.md": "# Planning\n[[planning]]\n" }));
  expect(result.findings).toEqual([]);
  expect(result.references[0]?.target).toBe("spec/planning.md");
});

test("matching topic stems in different files are ambiguous and never picked by traversal order", () => {
  for (const entries of [
    { "spec/first/planning.md": "# First", "spec/second/planning.md": "# Second" },
    { "spec/second/planning.md": "# Second", "spec/first/planning.md": "# First" },
  ]) {
    const result = semanticReferences(
      snapshot({ ...entries, "spec/source.md": "# Source\n[[Planning]]" }),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.references[0]?.target).toBeNull();
  }
});

test("titles are readable prose and never alternative topic identities", () => {
  const result = semanticReferences(
    snapshot({
      "spec/planning.md": "# Work",
      "spec/other.md": "# Planning",
      "spec/source.md": "# Source\n[[Planning]] [[Work]]",
    }),
  );
  expect(result.findings).toHaveLength(1);
  expect(result.references[0]?.target).toBe("spec/planning.md");
  expect(result.references[1]?.target).toBeNull();
});

test("topic and term identity do not invent hyphen and space aliases", () => {
  const result = semanticReferences(
    snapshot(
      {
        "spec/first-step.md": "# First step",
        "spec/source.md": "# Source\n[[first step]] {{first-step}} [[first-step]] {{First step}}",
      },
      ["first step"],
    ),
  );
  expect(result.findings).toHaveLength(2);
  expect(result.references.map((reference) => reference.target)).toEqual([
    null,
    null,
    "spec/first-step.md",
    "spec/terms.md:1",
  ]);
});

test("term identity collapses whitespace without changing source locations", () => {
  const result = semanticReferences(
    snapshot(
      {
        "spec/source.md": "# Source\n{{First\nstep}}",
      },
      ["first step"],
    ),
  );
  expect(result.findings).toEqual([]);
  expect(result.references[0]).toEqual(
    expect.objectContaining({ line: 2, target: "spec/terms.md:1" }),
  );
});

test("case-insensitive term duplicates remain ambiguous", () => {
  const result = semanticReferences(
    snapshot({ "spec/source.md": "# Source\n{{period}}" }, ["Period", "period"]),
  );
  expect(result.findings).toHaveLength(1);
  expect(result.references[0]?.target).toBeNull();
});

test("reading markup preserves real reference spelling and source lines", () => {
  const text = readFileSync(
    new URL("../../fixture/semantic-references/reader.md", import.meta.url),
    "utf8",
  );
  const result = semanticReferenceInventory(text);
  expect(result.title).toBe("Planning");
  expect(result.references).toEqual([
    { namespace: "topic", name: "Billing", line: 3 },
    { namespace: "term", name: "invoice", line: 3 },
    { namespace: "term", name: "period", line: 5 },
    { namespace: "topic", name: "Archive", line: 5 },
    { namespace: "topic", name: "Billing", line: 8 },
    { namespace: "term", name: "period", line: 8 },
  ]);
});

test("references remain references across paragraph and marker reflow", () => {
  const inventory = semanticReferenceInventory("# Planning\n\nSee\n[[Billing]]\nand {{period}}.\n");
  expect(inventory.references).toEqual([
    { namespace: "topic", name: "Billing", line: 4 },
    { namespace: "term", name: "period", line: 5 },
  ]);
});

test("inline and fenced code never create semantic references", () => {
  expect(
    semanticReferenceInventory("`[[Example]] {{sample}}`\n\n```md\n[[Example]] {{sample}}\n```\n")
      .references,
  ).toEqual([]);
});

test("escaped markers are examples while adjacent unescaped references still resolve", () => {
  expect(
    semanticReferenceInventory("\\[[Example]] \\{{sample}} [[Real]] {{value}}\n").references,
  ).toEqual([
    { namespace: "topic", name: "Real", line: 1 },
    { namespace: "term", name: "value", line: 1 },
  ]);
});

test("ordinary prose is never guessed to be a semantic reference", () => {
  expect(
    semanticReferenceInventory("# Plan\nDue and archive preserve the invoice period.\n").references,
  ).toEqual([]);
});

test("semantic markup leaves the existing claim declaration and reference grammar intact", () => {
  const inventory = claimInventory(
    "- Read [[Planning]] and {{value}}. · {#value-stays}\n\nSee {#value-stays}.\n",
    { separator: "·" },
  );
  expect(inventory).toEqual({
    declarations: [{ anchor: "value-stays", line: 1, terms: ["value"] }],
    references: [{ anchor: "value-stays", line: 3 }],
  });
});

test("incoming topic references derive from each source once despite repeated uses", () => {
  const result = semanticReferences(
    snapshot({
      "spec/planning.md": "# Planning",
      "spec/first.md": "# First\n[[Planning]] then [[planning]].",
      "spec/second.md": "# Second\n[[Planning]]",
    }),
  );
  const incoming = result.incomingTopics.find((entry) => entry.topic === "spec/planning.md");
  expect([...(incoming?.from ?? [])].sort()).toEqual(["spec/first.md", "spec/second.md"]);
});

test("moving a topic updates its incoming target without changing claims or import permissions", () => {
  const base = snapshot({
    "spec/planning.md": "# Planning\n- A value stays. · {#value-stays}",
    "spec/source.md": "# Source\n[[Planning]]",
  });
  const before: Snapshot = {
    ...base,
    files: [...base.files, { path: "oracle/planning/value-stays.test.ts", type: "test" }],
    claims: [{ file: "spec/planning.md", anchor: "value-stays", line: 2 }],
    imports: [{ from: "src/core/readings/value.ts", to: "src/substrate/primitives/store.ts" }],
  };
  const after: Snapshot = {
    ...before,
    files: before.files.map((file) => ({
      ...file,
      path: file.path
        .replace("spec/planning.md", "spec/new-planning.md")
        .replace("oracle/planning/", "oracle/new-planning/"),
    })),
    prose: before.prose.map((entry) => ({
      ...entry,
      file: entry.file.replace("spec/planning.md", "spec/new-planning.md"),
      text: entry.text.replace("[[Planning]]", "[[new-planning]]"),
    })),
    claims: [{ file: "spec/new-planning.md", anchor: "value-stays", line: 2 }],
  };
  expect(semanticReferences(before).references[0]?.target).toBe("spec/planning.md");
  expect(semanticReferences(after).references[0]?.target).toBe("spec/new-planning.md");
  expect(bindingFindings(before)).toEqual([]);
  expect(bindingFindings(after)).toEqual([]);
  expect(after.claims?.map((claim) => claim.anchor)).toEqual(
    before.claims?.map((claim) => claim.anchor),
  );
  expect(dependencyCheck(after)).toEqual(dependencyCheck(before));
  expect(dependencyCheck(before)).not.toEqual([]);
});

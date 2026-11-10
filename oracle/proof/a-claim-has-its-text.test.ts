import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { ClaimMarker } from "../../src/core/primitives/claim.js";
import { claimInventory, type ClaimInventory } from "../../src/core/readings/claim-inventory.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

// Words, not offsets, are compared, so an implementation may trim a range's whitespace as it likes.
const words = (value: string): string[] => value.split(/\s+/).filter(Boolean);

const declared = (inventory: ClaimInventory, anchor: string): ClaimMarker => {
  const [found, ...others] = inventory.declarations.filter((claim) => claim.anchor === anchor);
  expect(others, `one declaration of ${anchor}`).toEqual([]);
  if (found === undefined) throw new Error(`no declaration of ${anchor}`);
  return found;
};

const slices = (markdown: string, claim: ClaimMarker): string[] => {
  expect(claim.text, `${claim.anchor} has text ranges`).toBeDefined();
  return (claim.text ?? []).map(([start, end]) => markdown.slice(start, end));
};

const textWords = (markdown: string, claim: ClaimMarker): string[] => words(slices(markdown, claim).join(" "));

// Every inventory: each declaration's ranges are in source order, non-empty, inside the Markdown, and no
// two ranges overlap, even across declarations, since a claim declared inside another is not its text.
// References carry none.
const wellFormed = (markdown: string, inventory: ClaimInventory): void => {
  const all: (readonly [number, number])[] = [];
  for (const claim of inventory.declarations) {
    expect(claim.text, `${claim.anchor} has text ranges`).toBeDefined();
    const ranges = claim.text ?? [];
    for (const [index, [start, end]] of ranges.entries()) {
      expect(Number.isInteger(start) && Number.isInteger(end)).toBe(true);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(markdown.length);
      const previous = ranges[index - 1];
      if (previous !== undefined) expect(start).toBeGreaterThanOrEqual(previous[1]);
    }
    all.push(...ranges);
  }
  const ordered = [...all].sort((a, b) => a[0] - b[0]);
  for (const [index, [start]] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (previous !== undefined) expect(start).toBeGreaterThanOrEqual(previous[1]);
  }
  for (const reference of inventory.references) expect(reference).not.toHaveProperty("text");
};

const read = (markdown: string, options: Parameters<typeof claimInventory>[1] = {}): ClaimInventory => {
  const inventory = claimInventory(markdown, options);
  wellFormed(markdown, inventory);
  return inventory;
};

// Each generated document reaches the inventory as the prose of a fixture snapshot, as a topic is read.
const prose = (markdown: string): string => snapshotOf({ prose: [markdown] }).prose[0]?.text ?? "";

describe("a list claim's text is its promise paragraph", () => {
  const promises = [
    "Saves the result.",
    "Saves the result of {{complete}}\n  and keeps `{#example}` as a reference.",
    "Skips the [[outcomes]] item\n  across a wrapped line,\n  and a third.",
  ];
  const separators = [" · ", " "];
  const rows = [
    "",
    "  - Implementation: {{complete}}\n",
    "  - Proof: {{complete-cases}}\n",
    "  - Implementation: {{complete}}, {{surface}}\n  - Proof: {{complete-cases}}\n",
  ];
  const cases = promises.flatMap((promise) =>
    separators.flatMap((separator) => rows.map((row) => ({ promise, separator, row }))),
  );

  test.each(cases)(
    "without its anchor, separator or rows: $promise|$separator|$row",
    ({ promise, separator, row }) => {
      const markdown = prose(
        "# Commands\n\nWhat the commands do.\n\n## Available\n\n" +
          `- ${promise}${separator}{#claim}\n${row}` +
          "- A second claim stays apart. · {#second}\n  - Proof: {{second-cases}}\n",
      );
      const inventory = read(markdown, { separator: "·" });
      expect(textWords(markdown, declared(inventory, "claim"))).toEqual(words(promise));
      expect(textWords(markdown, declared(inventory, "second"))).toEqual(words("A second claim stays apart."));
      for (const slice of slices(markdown, declared(inventory, "claim"))) {
        expect(slice).not.toMatch(/\{#claim\}|Implementation:|Proof:/);
      }
    },
  );
});

describe("a table claim's text is its cells, in order", () => {
  const rows = [
    ["Complete {{complete}}", "Saves the result; see [[outcomes]].", "In Focus."],
    ["Skip", "", "Skips the `{#example}` item."],
    ["Archive", "Moves the item away, for good.", "Anywhere."],
  ];
  const separators = [" · ", " "];
  const closings = [" |", ""];
  const cases = rows.flatMap((cells) =>
    separators.flatMap((separator) => closings.map((closing) => ({ cells, separator, closing }))),
  );

  test.each(cases)("without the anchor or delimiters: $cells|$separator|$closing", ({ cells, separator, closing }) => {
    const row = `| ${cells.join(" | ")}${separator}{#row}${closing}`;
    const markdown = prose(
      "# Commands\n\n## Available commands\n\n| Command | What it does | Available when |\n| --- | --- | --- |\n" +
        `${row}\n| Stay | Stays put. | Always. · {#stay} |\n`,
    );
    const inventory = read(markdown, { separator: "·" });
    const claim = declared(inventory, "row");
    expect(textWords(markdown, claim)).toEqual(cells.flatMap(words));
    expect(textWords(markdown, declared(inventory, "stay"))).toEqual(words("Stay Stays put. Always."));
    const start = markdown.indexOf(row);
    for (const [from, to] of claim.text ?? []) {
      expect(from).toBeGreaterThanOrEqual(start);
      expect(to).toBeLessThanOrEqual(start + row.length);
    }
    for (const slice of slices(markdown, claim)) expect(slice).not.toMatch(/\||\{#row\}/);
  });
});

describe("a legacy anchored paragraph adds its explanatory bullets", () => {
  const bullets = [
    { source: "  - First explanation.\n", words: "First explanation." },
    {
      source: "  - First explanation\n    wraps.\n  - Second one.\n    - A nested detail.\n",
      words: "First explanation wraps. Second one. A nested detail.",
    },
    { source: "  - note:\n    - The labelled detail.\n", words: "The labelled detail." },
    { source: "  - note: kept whole.\n", words: "note: kept whole." },
  ];
  const separators = [" · ", " "];
  const rows = ["", "  - Implementation: {{value}}\n  - Proof: {{value-cases}}\n"];
  const cases = bullets.flatMap((bullet) =>
    separators.flatMap((separator) => rows.map((row) => ({ bullet, separator, row }))),
  );

  test.each(cases)("$bullet.source|$separator|$row", ({ bullet, separator, row }) => {
    const markdown = prose(`- A standing claim${separator}{#value-stays}\n${bullet.source}${row}`);
    const inventory = read(markdown, { legacy: true, separator: "·" });
    expect(textWords(markdown, declared(inventory, "value-stays"))).toEqual(
      words(`A standing claim ${bullet.words}`),
    );
  });

  test.each([
    { before: "", after: "  - After.\n", outer: "Outer claim After." },
    { before: "  - Before.\n", after: "  - After.\n", outer: "Outer claim Before. After." },
    { before: "  - Before.\n", after: "", outer: "Outer claim Before." },
  ])("a claim declared inside is its own text, not the outer one's: $outer", ({ before, after, outer }) => {
    const markdown = prose(
      `- Outer claim · {#outer}\n${before}  - Inner claim · {#inner}\n    - Inner detail.\n${after}`,
    );
    const inventory = read(markdown, { legacy: true, separator: "·" });
    expect(textWords(markdown, declared(inventory, "outer"))).toEqual(words(outer));
    expect(textWords(markdown, declared(inventory, "inner"))).toEqual(words("Inner claim Inner detail."));
  });
});

describe("a legacy law section is its heading's explanation and its bullets up to the marker", () => {
  test.each([
    {
      section: "- A value stays.\n\n- {#value-stays}\n",
      words: "a standing rule A value stays.",
    },
    {
      section:
        "- def:\n  - A value stays.\n- laws:\n  - It never moves.\n  - It never splits.\n\n" +
        "- {#value-stays}\n  - Implementation: {{value}}\n  - Proof: {{value-cases}}\n",
      words: "a standing rule A value stays. It never moves. It never splits.",
    },
    {
      section: "- def: words that stay\n- Two words: both kept\n- Two words:\n  - A child.\n\n- {#value-stays}\n",
      words: "a standing rule def: words that stay Two words: both kept Two words: A child.",
    },
    {
      section: "- def:\n  - The rule.\n- Inner rule · {#inner}\n  - Inner detail.\n- After.\n\n- {#value-stays}\n",
      words: "a standing rule The rule. After.",
      inner: "Inner rule Inner detail.",
    },
  ])("$words", ({ section, words: expected, inner }) => {
    const markdown = prose(`### law · value-stays — a standing rule\n\n${section}`);
    const inventory = read(markdown, { legacy: true, separator: "·" });
    expect(textWords(markdown, declared(inventory, "value-stays"))).toEqual(words(expected));
    if (inner !== undefined) expect(textWords(markdown, declared(inventory, "inner"))).toEqual(words(inner));
  });

  test("a heading without an explanation contributes nothing, and the next section is its own", () => {
    const markdown = prose(
      "### law · first-rule\n\n- One rule.\n\n- {#first-rule}\n\n" +
        "### law · second-rule — the second\n\n- laws:\n  - Two rule.\n\n- {#second-rule}\n",
    );
    const inventory = read(markdown, { legacy: true, separator: "·" });
    expect(textWords(markdown, declared(inventory, "first-rule"))).toEqual(words("One rule."));
    expect(textWords(markdown, declared(inventory, "second-rule"))).toEqual(words("the second Two rule."));
  });
});

// The Kit's own topics as a fixture: each list claim's promise paragraph, read line by line, independently
// of the inventory's Markdown parser.
const promiseParagraphs = (markdown: string): Map<string, string[]> => {
  const claims = new Map<string, string[]>();
  const lines = markdown.split("\n");
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced || !line.startsWith("- ")) continue;
    const paragraph = [line.slice(2)];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() === "" || /^\s*(- |#|\||```)/.test(next)) break;
      paragraph.push(next);
    }
    const tokens = words(paragraph.join(" "));
    const anchor = /^\{#([\w-]+)\}$/.exec(tokens.at(-1) ?? "")?.[1];
    if (anchor === undefined) continue;
    tokens.pop();
    if (tokens.at(-1) === "·") tokens.pop();
    claims.set(anchor, tokens);
  }
  return claims;
};

describe("the round trip over the Kit's own spec", () => {
  const spec = new URL("../../spec/", import.meta.url);
  const files = readdirSync(spec)
    .filter((file) => file.endsWith(".md") && file !== "terms.md")
    .sort();
  const topics = snapshotOf({ prose: files.map((file) => readFileSync(new URL(file, spec), "utf8")) }).prose.map(
    (topic, index) => ({ ...topic, file: `spec/${files[index] ?? ""}` }),
  );

  test("the spec has topics, and this claim is among them", () => {
    expect(topics.length).toBeGreaterThan(1);
    const proof = topics.find((topic) => topic.file === "spec/proof.md")?.text ?? "";
    expect(promiseParagraphs(proof).has("a-claim-has-its-text")).toBe(true);
  });

  test.each(topics.map((topic) => ({ file: topic.file, markdown: topic.text })))(
    "slicing $file by each claim's ranges gives exactly its words",
    ({ markdown }) => {
      const inventory = read(markdown, { separator: "·" });
      const expected = promiseParagraphs(markdown);
      expect(inventory.declarations.map((claim) => claim.anchor).sort()).toEqual([...expected.keys()].sort());
      for (const claim of inventory.declarations) {
        expect(textWords(markdown, claim), claim.anchor).toEqual(expected.get(claim.anchor));
      }
    },
  );
});

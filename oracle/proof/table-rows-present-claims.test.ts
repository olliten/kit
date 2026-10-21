import { expect, test } from "vitest";
import { claimInventory } from "../../src/core/readings/claim-inventory.js";
import { topicShape } from "../../src/core/readings/topic-shape.js";
import { semanticReferenceInventory } from "../../src/core/readings/semantic-references.js";
import { bindingFindings } from "../core/readings/binding-findings.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const table = "# Commands\n\n## Available commands\n\n" +
  "| Command | What it does | Available when |\n| --- | --- | --- |\n" +
  "| Complete {{complete}} | Saves the result; see [[outcomes]]. | In Focus. · {#complete}\n" +
  "| Skip | Skips the current item. | In Focus. · {#skip}\n";

test("each data row is one claim, collecting references from all its cells", () => {
  expect(topicShape(snapshotOf({ prose: [table] }))).toEqual([]);
  expect(claimInventory(table)).toEqual({
    declarations: [
      { anchor: "complete", line: 7, terms: ["complete"] },
      { anchor: "skip", line: 8 },
    ], references: [],
  });
  expect(semanticReferenceInventory(table).references).toEqual([
    { namespace: "term", name: "complete", line: 7 },
    { namespace: "topic", name: "outcomes", line: 7 },
  ]);
});

test("moving list claims into rows preserves their proof homes", () => {
  const list = "# Commands\n\n- Complete {{complete}} saves the result. In Focus. · {#complete}\n" +
    "- Skip skips the current item. In Focus. · {#skip}\n";
  const snapshot = snapshotOf({ files: ["oracle/commands/complete.test.ts", "oracle/commands/skip.test.ts"] });
  const findings = (text: string) => bindingFindings({ ...snapshot,
    claims: claimInventory(text).declarations.map((claim) => ({ ...claim, file: "spec/commands.md" })),
  });
  expect(findings(list)).toEqual([]);
  expect(findings(table)).toEqual([]);
  const duplicate = findings(table + "\n- Complete again. · {#complete}\n");
  expect(duplicate.map((row) => row.debtKey)).toEqual(["R3:duplicate-claim:complete"]);
  expect(bindingFindings({ ...snapshotOf({}), claims:
    claimInventory(table).declarations.map((claim) => ({ ...claim, file: "spec/commands.md" })),
  }).map((row) => row.debtKey)).toEqual([
    "R3:missing-proof:spec/commands.md:complete", "R3:missing-proof:spec/commands.md:skip",
  ]);
});

test.each([
  "| Skip | No anchor |",
  "| Skip {#skip} | An anchor in the wrong cell |",
  "| Skip | {#skip} trailing prose |",
  "| Skip {#other} | Ends. {#skip} |",
  "| Skip | `Only an example {#skip}` |",
  "| Skip | **{#skip}** |",
  "| Only one cell. {#skip} |",
  "| Skip | Behavior | Hidden extra cell. {#skip} |",
])("a malformed row remains a shape finding: %s", (row) => {
  const prose = "# Commands\n\n| Command | Behavior |\n| --- | --- |\n" + row + "\n";
  expect(topicShape(snapshotOf({ prose: [prose] })).map((item) => item.debtKey)).toEqual([
    "R4:topic-shape:spec/topic.md:5",
  ]);
});

test("headers, separators, fenced examples and cells have no independent claim home", () => {
  const prose = "# Commands\n\n| Command {#header} | Behavior |\n| --- | --- |\n" +
    "| Skip | Skips. {#skip} |\n\n```md\n| Example | {#example} |\n```\n";
  expect(claimInventory(prose)).toEqual({
    declarations: [{ anchor: "skip", line: 5 }],
    references: [{ anchor: "header", line: 3 }],
  });
});

test("escaped pipes and code examples do not split claims or invent module references", () => {
  const prose = "# Commands\n\n| Command | Behavior |\n| --- | --- |\n" +
    "| Either a\\|b | `{{example}}` and {{actual}}. {#either} |\n";
  expect(topicShape(snapshotOf({ prose: [prose] }))).toEqual([]);
  expect(claimInventory(prose).declarations).toEqual([
    { anchor: "either", line: 5, terms: ["actual"] },
  ]);
});

test("row order and mixing lists with tables changes no claim identity", () => {
  const text = "# Commands\n\n- Separate promise. {#separate}\n\n" +
    "| Behavior |\n| --- |\n| Second. {#second} |\n| First. {#first} |\n";
  expect(topicShape(snapshotOf({ prose: [text] }))).toEqual([]);
  expect(claimInventory(text).declarations.map((claim) => claim.anchor)).toEqual([
    "separate", "second", "first",
  ]);
});

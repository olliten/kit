import { expect, test } from "vitest";
import { topicShape } from "../../src/core/readings/topic-shape.js";
import { snapshotOf } from "../lib/snapshotOf.js";

const shape = (text: string) =>
  topicShape(snapshotOf({ prose: [text] })).map((row) => row.debtKey.split(":").slice(0, 2).join(":") + ":" + row.debtKey.split(":").at(-1));

test("a title, a short intro, sections and claims make a topic", () => {
  expect(
    shape(
      "# Tally\n\nCounting what was supplied. It never stores anything.\n\n## Totals\n\n" +
        "- A total of no steps is zero. {{total}} · {#empty-total}\n" +
        "- An average is the total over the count. {{average}} · {#average}\n",
    ),
  ).toEqual([]);
});

test("a topic starts with its title", () => {
  expect(shape("Counting.\n\n# Tally\n")).toEqual(["R4:topic-shape:1"]);
});

test("an intro of more than three sentences is a finding", () => {
  expect(shape("# Tally\n\nOne. Two. Three. Four.\n")).toEqual(["R4:topic-shape:3"]);
});

test("prose after the intro is a finding, so a requirement cannot hide in it", () => {
  expect(shape("# Tally\n\nCounting.\n\n## Totals\n\nEvery total is exact.\n")).toEqual(["R4:topic-shape:7"]);
});

test("a list item that is not a claim is a finding", () => {
  expect(shape("# Tally\n\n- Totals are exact.\n- A total of no steps is zero. · {#empty-total}\n")).toEqual([
    "R4:topic-shape:3",
  ]);
});

test("a topic has no module headings; modules are named by the claims they keep", () => {
  expect(shape("# Tally\n\n### core/readings/total\n")).toEqual(["R4:topic-shape:3"]);
  expect(shape("# Tally\n\n### Totals\n")).toEqual(["R4:topic-shape:3"]);
});

test("code, tables and quotes do not belong in a topic", () => {
  expect(shape("# Tally\n\n```ts\nconst x = 1;\n```\n")).toEqual(["R4:topic-shape:3"]);
});

test("the terms file, legacy areas and a README are not topics", () => {
  const snapshot = snapshotOf({});
  const prose = ["spec/terms.md", "spec/README.md"].map((file) => ({ file, text: "Loose prose.\n" }));
  expect(topicShape({ ...snapshot, prose })).toEqual([]);
  expect(
    topicShape({
      ...snapshot,
      config: { ...snapshot.config, legacyAreas: ["spec/old.md"] },
      prose: [{ file: "spec/old.md", text: "Loose prose.\n" }],
    }),
  ).toEqual([]);
});

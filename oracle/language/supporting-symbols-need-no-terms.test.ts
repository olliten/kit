import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { termModel } from "../../src/core/readings/term-model.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { snapshotOf } from "../lib/snapshotOf.js";

test("a supporting exported type needs no glossary entries for its ordinary words", () => {
  const snapshot = readSnapshot(fileURLToPath(new URL("../..", import.meta.url)));
  expect(snapshot.symbols).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: "src/core/primitives/term.ts", name: "TermSyntaxIssue" }),
    ]),
  );
  expect(snapshot.terms.some((term) => term.term === "syntax" || term.term === "issue")).toBe(
    false,
  );
  expect(nameCheck(snapshot)).toEqual([]);
  expect(termModel(snapshot)).toEqual({ findings: [], limits: [] });
});

test("retiring a word still holds a supporting exported type", () => {
  expect(
    nameCheck(
      snapshotOf({
        terms: ["term", "observation · retired: issue"],
        symbols: ["src/core/primitives/term.ts#TermSyntaxIssue"],
      }),
    ).map((finding) => finding.debtKey),
  ).toEqual(["R3:retired-word:core/primitives/term:issue"]);
});

import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { termModel } from "../../src/core/readings/term-model.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";

test("Kit's real placed homes bind to its actual declared concepts without supporting-word terms", () => {
  const snapshot = readSnapshot(fileURLToPath(new URL("../..", import.meta.url)));
  expect(snapshot.files.some((file) => file.path === "src/core/primitives/term.ts")).toBe(true);
  expect(snapshot.symbols.some((symbol) => symbol.name === "TermSyntaxIssue")).toBe(true);
  expect(snapshot.terms.some((term) => term.term === "syntax" || term.term === "issue")).toBe(
    false,
  );
  expect(termModel(snapshot)).toEqual({ findings: [], limits: [] });
});

import { expect, test } from "vitest";
import { dependencyCheck } from "../../../src/core/reading/dependencyCheck.js";
import { snapshotOf } from "../../lib/snapshotOf.js";

const keysOf = (...imports: string[]) =>
  dependencyCheck(snapshotOf({ imports })).map((f) => f.debtKey);

test("a chain is acyclic", () => {
  expect(
    keysOf(
      "src/core/reading/a.ts > src/core/reading/b.ts",
      "src/core/reading/b.ts > src/core/reading/c.ts",
    ),
  ).toEqual([]);
});

test("a cycle is one finding at its first artifact, naming every member", () => {
  const findings = dependencyCheck(
    snapshotOf({
      imports: [
        "src/core/reading/c.ts > src/core/reading/a.ts",
        "src/core/reading/a.ts > src/core/reading/b.ts",
        "src/core/reading/b.ts > src/core/reading/c.ts",
      ],
    }),
  );
  expect(findings.map((f) => [f.path, f.debtKey])).toEqual([
    ["core/reading/a", "R2:cycle:core/reading/a:core/reading/a,core/reading/b,core/reading/c"],
  ]);
  expect(findings[0]?.fix).toContain(
    "core/reading/a → core/reading/b → core/reading/c → core/reading/a",
  );
});

test("a self-import is a cycle; two separate cycles are two findings", () => {
  expect(
    keysOf(
      "src/core/data/x.ts > src/core/data/x.ts",
      "src/shell/reading/p.ts > src/shell/reading/q.ts",
      "src/shell/reading/q.ts > src/shell/reading/p.ts",
    ),
  ).toEqual([
    "R2:cycle:core/data/x:core/data/x",
    "R2:cycle:shell/reading/p:shell/reading/p,shell/reading/q",
  ]);
});

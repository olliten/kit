import { expect, test } from "vitest";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { snapshotOf } from "../lib/snapshotOf.js";

const keysOf = (...imports: string[]) =>
  dependencyCheck(snapshotOf({ imports })).map((f) => f.debtKey);

test("a chain is acyclic", () => {
  expect(
    keysOf(
      "src/core/readings/a.ts > src/core/readings/b.ts",
      "src/core/readings/b.ts > src/core/readings/c.ts",
    ),
  ).toEqual([]);
});

test("a cycle is one finding at its first artifact, naming every member", () => {
  const findings = dependencyCheck(
    snapshotOf({
      imports: [
        "src/core/readings/c.ts > src/core/readings/a.ts",
        "src/core/readings/a.ts > src/core/readings/b.ts",
        "src/core/readings/b.ts > src/core/readings/c.ts",
      ],
    }),
  );
  expect(findings.map((f) => [f.path, f.debtKey])).toEqual([
    ["core/readings/a", "R2:cycle:core/readings/a:core/readings/a,core/readings/b,core/readings/c"],
  ]);
  expect(findings[0]?.fix).toContain(
    "core/readings/a → core/readings/b → core/readings/c → core/readings/a",
  );
});

test("a self-import is a cycle; two separate cycles are two findings", () => {
  expect(
    keysOf(
      "src/core/primitives/x.ts > src/core/primitives/x.ts",
      "src/shell/readings/p.ts > src/shell/readings/q.ts",
      "src/shell/readings/q.ts > src/shell/readings/p.ts",
    ),
  ).toEqual([
    "R2:cycle:core/primitives/x:core/primitives/x",
    "R2:cycle:shell/readings/p:shell/readings/p,shell/readings/q",
  ]);
});

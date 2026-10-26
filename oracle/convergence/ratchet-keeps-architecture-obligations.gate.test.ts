import { expect, test } from "vitest";
import { gate } from "../../src/core/compositions/gate.js";
import { ratchetFindings } from "../../src/core/readings/ratchet.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

test("the gate reports what it can't establish as a limit, and a baseline that names it doesn't waive it", () => {
  const snapshot = snapshotOf({
    files: ["src/core/readings/a.ts", "src/core/readings/b.ts"],
    imports: ["src/core/readings/a.ts > src/core/readings/b.ts"],
  });
  const config = {
    ...snapshot.config,
    dependencyExclusions: [
      { from: "src/core/readings/a.ts", to: "src/core/readings/b.ts", imports: "runtime" as const, reach: "transitive" as const },
    ],
  };
  const result = gate({ ...snapshot, config }, config);
  const limit = "R2:dependency-boundary:src/core/readings/a.ts:src/core/readings/a.ts";
  expect(result.requiredLimits.map((item) => [item.debtKey, item.category, item.limit])).toEqual([
    [limit, "checker-limit", "No checked import evidence establishes src/core/readings/a.ts."],
  ]);
  const baseline = Object.fromEntries(result.findings.map((item) => [item.debtKey, null]));
  const failing = [...ratchetFindings(result.findings, baseline, result.placedPaths, result.imports), ...result.requiredLimits];
  expect(failing.map((item) => item.debtKey)).toContain(limit);
});

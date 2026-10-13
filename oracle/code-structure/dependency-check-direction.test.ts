import { describe, expect, test } from "vitest";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { snapshotOf } from "../lib/snapshotOf.js";

const keysOf = (...imports: string[]) =>
  dependencyCheck(snapshotOf({ imports })).map((f) => f.debtKey);

describe("dependencyCheck: within a zone, primitives ← readings ← compositions", () => {
  test("a layer imports its own layer or an earlier one", () => {
    expect(
      keysOf(
        "src/core/primitives/s.ts > src/core/primitives/d.ts",
        "src/core/readings/r.ts > src/core/primitives/s.ts",
        "src/core/readings/r.ts > src/core/readings/q.ts",
        "src/core/compositions/c.ts > src/core/readings/r.ts",
        "src/shell/compositions/e.ts > src/shell/readings/r.ts",
      ),
    ).toEqual([]);
  });

  test("an import of a later layer is a finding", () => {
    expect(keysOf("src/core/readings/r.ts > src/core/compositions/c.ts")).toEqual([
      "R2:edge:core/readings/r:core/compositions/c",
    ]);
  });
});

describe("dependencyCheck: across zones, only inward to core modules", () => {
  test("shell and substrate may import core primitives, readings and compositions", () => {
    expect(
      keysOf(
        "src/shell/readings/v.ts > src/core/primitives/d.ts",
        "src/shell/compositions/e.ts > src/core/readings/r.ts",
        "src/substrate/compositions/x.ts > src/core/compositions/c.ts",
      ),
    ).toEqual([]);
  });

  test("a shell reading cannot import a substrate module", () => {
    const [f] = dependencyCheck(
      snapshotOf({ imports: ["src/shell/readings/v.ts > src/substrate/primitives/s.ts"] }),
    );
    expect(f?.debtKey).toBe("R2:edge:shell/readings/v:substrate/primitives/s");
    expect(f?.fix).toContain("core");
  });

  test("the core imports outward, and shell and substrate import each other", () => {
    expect(
      keysOf(
        "src/core/readings/r.ts > src/substrate/primitives/d.ts",
        "src/shell/compositions/e.ts > src/substrate/compositions/x.ts",
        "src/substrate/compositions/x.ts > src/shell/primitives/t.ts",
      ),
    ).toEqual([
      "R2:edge:core/readings/r:substrate/primitives/d",
      "R2:edge:shell/compositions/e:substrate/compositions/x",
      "R2:edge:substrate/compositions/x:shell/primitives/t",
    ]);
  });

  test("imports with a legacy end are not held", () => {
    expect(
      keysOf("src/main.ts > src/core/primitives/s.ts", "src/core/primitives/d.ts > src/util.ts"),
    ).toEqual([]);
  });

  test("a repeated import gives one finding", () => {
    const edge = "src/shell/readings/v.ts > src/substrate/primitives/s.ts";
    expect(keysOf(edge, edge)).toHaveLength(1);
  });
});

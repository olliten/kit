import { describe, expect, test } from "vitest";
import { dependencyCheck } from "../../../src/core/reading/dependencyCheck.js";
import { snapshotOf } from "../../lib/snapshotOf.js";

const keysOf = (...imports: string[]) =>
  dependencyCheck(snapshotOf({ imports })).map((f) => f.debtKey);

describe("dependencyCheck: within a zone, data ← state ← reading ← change ← effect", () => {
  test("a kind imports its own kind or an earlier one", () => {
    expect(
      keysOf(
        "src/core/state/s.ts > src/core/data/d.ts",
        "src/core/reading/r.ts > src/core/state/s.ts",
        "src/core/reading/r.ts > src/core/reading/q.ts",
        "src/core/change/c.ts > src/core/reading/r.ts",
        "src/shell/effect/e.ts > src/shell/reading/r.ts",
      ),
    ).toEqual([]);
  });

  test("an import of a later kind is a finding", () => {
    expect(keysOf("src/core/reading/r.ts > src/core/change/c.ts")).toEqual([
      "R2:edge:core/reading/r:core/change/c",
    ]);
  });
});

describe("dependencyCheck: across zones, only inward to core data, readings and changes", () => {
  test("shell and substrate may import core data, readings and changes", () => {
    expect(
      keysOf(
        "src/shell/reading/v.ts > src/core/data/d.ts",
        "src/shell/effect/e.ts > src/core/reading/r.ts",
        "src/substrate/effect/x.ts > src/core/change/c.ts",
      ),
    ).toEqual([]);
  });

  test("core state is private", () => {
    const [f] = dependencyCheck(
      snapshotOf({ imports: ["src/shell/reading/v.ts > src/core/state/s.ts"] }),
    );
    expect(f?.debtKey).toBe("R2:edge:shell/reading/v:core/state/s");
    expect(f?.fix).toContain("private");
  });

  test("the core imports outward, and shell and substrate import each other", () => {
    expect(
      keysOf(
        "src/core/reading/r.ts > src/substrate/data/d.ts",
        "src/shell/effect/e.ts > src/substrate/effect/x.ts",
        "src/substrate/effect/x.ts > src/shell/data/t.ts",
      ),
    ).toEqual([
      "R2:edge:core/reading/r:substrate/data/d",
      "R2:edge:shell/effect/e:substrate/effect/x",
      "R2:edge:substrate/effect/x:shell/data/t",
    ]);
  });

  test("imports with a legacy end are not held", () => {
    expect(keysOf("src/main.ts > src/core/state/s.ts", "src/core/data/d.ts > src/util.ts")).toEqual(
      [],
    );
  });

  test("a repeated import gives one finding", () => {
    const edge = "src/shell/reading/v.ts > src/core/state/s.ts";
    expect(keysOf(edge, edge)).toHaveLength(1);
  });
});

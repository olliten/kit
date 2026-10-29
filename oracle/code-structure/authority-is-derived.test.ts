import { afterAll, describe, expect, test } from "vitest";
import { capabilityCheck } from "../../src/core/compositions/capability-check.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { fixtureConfig } from "../core/readings/fixture-config.js";
import { CAPABILITY_APP } from "../core/primitives/capability-app.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const project = temporaryProjects.open("kit-capabilities-");
project.write(CAPABILITY_APP);
afterAll(() => project.dispose());
const fixtureRoot = project.root;
const snapshot = readSnapshot(fixtureRoot, fixtureConfig);
const result = capabilityCheck(snapshot);
const requirements = (path: string) => {
  const row = result.requirements.find((candidate) => candidate.path === path);
  expect(row, `actual derived requirements missing for ${path}`).toBeDefined();
  if (row === undefined) throw Error(`no requirements for ${path}`);
  return row;
};
const findings = (path: string) => result.findings.filter((finding) => finding.path === path);
const violation = (path: string) =>
  expect(findings(path), path).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
  );
const unresolved = (path: string) => {
  const rows = findings(path).filter((finding) => finding.status === "unresolved");
  expect(rows.length, path).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.blocking, path).toBe(true);
    expect(row.limit.length, path).toBeGreaterThan(0);
  }
};
const clear = (path: string) =>
  expect(
    findings(path).filter((finding) => finding.blocking),
    path,
  ).toEqual([]);

describe("runtime authority is conservatively derived from actual module inputs", () => {
  test("A0: type-only schemas and constants require no fabricated runtime value", () => {
    expect(requirements("src/core/primitives/schema.ts")).toMatchObject({
      direct: [],
      inherited: [],
    });
    clear("src/core/primitives/schema.ts");
  });

  test("A0: readonly literal precision is supported while unchecked value casts remain violations", () => {
    clear("src/core/primitives/readonly-roster.ts");
    expect(findings("src/core/readings/cast-production.ts")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          debtKey: expect.stringMatching(/^R1:type-escape:/),
          status: "violation",
          blocking: true,
        }),
      ]),
    );
  });

  test("A0: directly indexed non-null assertions are permitted without permitting casts", () => {
    clear("src/core/readings/indexed-value.ts");
    expect(findings("src/core/readings/indexed-cast.ts")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          debtKey: expect.stringMatching(/^R1:type-escape:/),
          status: "violation",
          blocking: true,
        }),
      ]),
    );
  });

  test.each(["src/core/readings/optional-property.ts", "src/core/readings/function-result.ts"])(
    "A0: non-indexed non-null assertion remains a type escape at %s",
    (path) => {
      expect(findings(path)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            debtKey: expect.stringMatching(/^R1:type-escape:/),
            status: "violation",
            blocking: true,
          }),
        ]),
      );
    },
  );

  test("A4: a raw primitive is reported once rather than repeated as zone authority", () => {
    const causes = findings("src/core/primitives/raw-clock.ts").filter((finding) =>
      /^R1:(raw-primitive|zone-authority):/.test(finding.debtKey),
    );
    expect(causes).toHaveLength(1);
    expect(causes[0]).toMatchObject({ status: "violation", blocking: true });
  });

  test("A5: imported reading authority is reported once rather than repeated as zone authority", () => {
    const causes = findings("src/core/readings/mapped-randomness.ts").filter((finding) =>
      /^R1:(reading-authority|zone-authority):/.test(finding.debtKey),
    );
    expect(causes).toHaveLength(1);
    expect(causes[0]).toMatchObject({ status: "violation", blocking: true });
  });

  test("A5: dynamic global authority remains unresolved without treating every ambient call as an entry", () => {
    for (const path of [
      "src/core/primitives/dynamic-access.ts",
      "src/core/compositions/separate-unknown-calls.ts",
    ]) {
      expect(findings(path)).toEqual([
        expect.objectContaining({
          debtKey: expect.stringMatching(/^R1:authority-entry:/),
          status: "unresolved",
          blocking: true,
        }),
      ]);
    }
    clear("src/core/readings/ambient-call.ts");
  });

  test("A1: a genuine adapter is narrow; re-export and pure-export selection inherit its authority", () => {
    expect(requirements("src/substrate/primitives/cell-store.ts").direct).toEqual(["cell.apply"]);
    clear("src/substrate/primitives/cell-store.ts");
    expect(requirements("src/substrate/primitives/cell-exports.ts").inherited).toEqual([
      "cell.apply",
    ]);
    expect(requirements("src/substrate/readings/clean-cell.ts").inherited).toEqual(["cell.apply"]);
    violation("src/substrate/readings/clean-cell.ts");
  });

  test("A1: type-only dependency on the authority module grants no runtime authority", () => {
    expect(requirements("src/substrate/readings/cell-shape.ts")).toMatchObject({
      direct: [],
      inherited: [],
    });
    clear("src/substrate/readings/cell-shape.ts");
  });

  test("A2: applying a write and accepting its actual authority type cannot be hidden in a reading", () => {
    expect(requirements("src/substrate/readings/write-cell.ts").direct).toContain("cell.apply");
    violation("src/substrate/readings/write-cell.ts");
  });

  test("A2: a registered contract type derives the named port without a runtime adapter import", () => {
    const config = {
      ...fixtureConfig,
      adapters: (fixtureConfig.adapters ?? []).map((adapter) =>
        adapter.module === "substrate/primitives/cell-store"
          ? { ...adapter, contract: { type: "CellWriter" } }
          : adapter,
      ),
    };
    const selected = readSnapshot(fixtureRoot, config);
    const actual = capabilityCheck(selected);
    const path = "src/substrate/readings/parameter-only-write.ts";
    const imports = selected.compiler?.projects.flatMap((project) => project.imports) ?? [];
    expect(imports.filter((edge) => edge.file === path)).toEqual([
      expect.objectContaining({ specifier: "../../core/primitives/schema.js", typeOnly: true }),
      expect.objectContaining({ specifier: "../primitives/cell-store.js", typeOnly: true }),
    ]);
    expect(actual.requirements.find((row) => row.path === path)).toMatchObject({
      direct: ["cell.apply"],
      inherited: ["cell.apply"],
    });
    expect(actual.findings.filter((finding) => finding.path === path)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
    );
  });

  test("D2: a named union producer cannot lose visible construction through contextual narrowing", () => {
    const config = {
      ...fixtureConfig,
      adapters: [
        ...(fixtureConfig.adapters ?? []),
        {
          module: "core/compositions/union-description",
          export: "putDescription",
          capability: "union.produce",
          kind: "produce" as const,
          zones: ["core" as const],
        },
      ],
    };
    const actual = capabilityCheck(readSnapshot(fixtureRoot, config));
    expect(
      actual.findings.filter(
        (finding) =>
          finding.path === "src/core/compositions/union-description.ts" && finding.blocking,
      ),
    ).toEqual([]);
    expect(actual.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/core/readings/union-literal.ts",
          status: "violation",
          blocking: true,
        }),
        expect.objectContaining({
          path: "src/core/readings/union-spread.ts",
          status: "violation",
          blocking: true,
        }),
      ]),
    );
  });

  test("A3: actual contract members are derived once; semantic narrowness remains review-held", () => {
    const contracts = snapshot.compiler?.projects.flatMap((project) => project.contracts) ?? [];
    const broad = contracts.find(
      (contract) =>
        contract.file === "src/substrate/primitives/broad-service.ts" &&
        contract.name === "BroadService",
    );
    const narrow = contracts.find(
      (contract) =>
        contract.file === "src/substrate/primitives/cell-store.ts" &&
        contract.name === "CellWriter",
    );
    expect(broad?.operations.slice().sort()).toEqual(["put", "read", "remove"]);
    expect(narrow?.operations).toEqual(["put"]);
    expect(requirements("src/substrate/primitives/broad-service.ts").direct).toEqual([
      "cell.apply",
    ]);
    // A3 protocol narrowness remains semantic review; no operation-count rule is asserted.
  });

  test("A4: a raw core clock is forbidden while the registered substrate adapter is supported", () => {
    violation("src/core/primitives/raw-clock.ts");
    expect(requirements("src/substrate/adapters/clock.ts").direct).toEqual(["clock.read"]);
    clear("src/substrate/adapters/clock.ts");
  });

  test("A4: app config cannot relabel intrinsic clock access as permitted write production", () => {
    const poisoned = {
      ...fixtureConfig,
      adapters: [
        ...(fixtureConfig.adapters?.filter(
          (adapter) => adapter.module !== "substrate/adapters/clock",
        ) ?? []),
        {
          module: "core/primitives/raw-clock",
          export: "currentInstant",
          capability: "clock.read",
          kind: "produce" as const,
          zones: ["core" as const],
          primitives: ["clock" as const],
        },
      ],
    };
    const actual = capabilityCheck(readSnapshot(fixtureRoot, poisoned));
    expect(
      actual.findings.filter((finding) => finding.path === "src/core/primitives/raw-clock.ts"),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
    );
  });

  test("A4: registered raw clock access cannot hide its forbidden actual zone", () => {
    const config = {
      ...fixtureConfig,
      adapters: (fixtureConfig.adapters ?? []).map((adapter) =>
        adapter.module === "substrate/adapters/clock"
          ? { ...adapter, zones: ["core" as const] }
          : adapter,
      ),
    };
    const actual = capabilityCheck(readSnapshot(fixtureRoot, config));
    expect(actual.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/substrate/adapters/clock.ts",
          debtKey: "R1:zone-authority:src/substrate/adapters/clock.ts:clock.read",
          status: "violation",
          blocking: true,
        }),
      ]),
    );
  });

  test("A1: real local legacy imports retain clock authority while type-only imports grant none", () => {
    expect(requirements("src/core/legacy/clock.ts").direct).toEqual(["clock"]);
    expect(requirements("src/core/readings/legacy-clock.ts").inherited).toEqual(["clock"]);
    violation("src/core/readings/legacy-clock.ts");
    expect(requirements("src/core/readings/legacy-shape.ts")).toMatchObject({
      direct: [],
      inherited: [],
    });
    clear("src/core/readings/legacy-shape.ts");
  });

  test("A1: an ordinary local method call creates no authority without an entry", () => {
    expect(requirements("src/core/compositions/local-method.ts")).toMatchObject({
      direct: [],
      inherited: [],
    });
    clear("src/core/compositions/local-method.ts");
  });

  test("A5: an unsupported package loaded dynamically remains an unresolved authority entry", () => {
    unresolved("src/core/compositions/dynamic-import.ts");
  });

  test("A5: configured ambient authority uses real symbol provenance, excluding shadows and erased types", () => {
    const config = {
      ...fixtureConfig,
      adapters: [
        ...(fixtureConfig.adapters ?? []),
        {
          module: "substrate/primitives/ambient",
          export: "acquireAmbient",
          capability: "ambient.read",
          kind: "external" as const,
          zones: ["substrate" as const],
          globals: ["ambientRead"],
        },
      ],
    };
    const actual = capabilityCheck(readSnapshot(fixtureRoot, config));
    for (const path of [
      "src/substrate/primitives/ambient.ts",
      "src/core/primitives/ambient-acquisition.ts",
      "src/core/readings/ambient-call.ts",
    ]) {
      expect(actual.requirements.find((row) => row.path === path)?.direct).toContain(
        "ambient.read",
      );
    }
    expect(actual.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/core/primitives/ambient-acquisition.ts",
          status: "violation",
          blocking: true,
        }),
      ]),
    );
    for (const path of [
      "src/core/readings/ambient-shadow.ts",
      "src/core/primitives/ambient-type.ts",
    ]) {
      expect(actual.requirements.find((row) => row.path === path)).toMatchObject({
        direct: [],
        inherited: [],
      });
      expect(
        actual.findings.filter((finding) => finding.path === path && finding.blocking),
      ).toEqual([]);
    }
  });

  test("A5: conversion of supplied time has no clock authority", () => {
    expect(requirements("src/core/readings/time-conversion.ts")).toMatchObject({
      direct: [],
      inherited: [],
    });
    clear("src/core/readings/time-conversion.ts");
  });

  test("A5: aliased randomness remains visible and dynamic access remains unresolved", () => {
    violation("src/core/primitives/aliased-randomness.ts");
    unresolved("src/core/primitives/dynamic-access.ts");
  });

  test("A5: acquiring the dynamic evaluator without invoking it remains an authority entry", () => {
    unresolved("src/core/primitives/eval-acquisition.ts");
  });

  test("A5: destructuring acquires raw authority before a supported collection consumes it", () => {
    expect(requirements("src/core/primitives/destructured-randomness.ts").direct).toEqual([
      "randomness",
    ]);
    expect(requirements("src/core/readings/destructured-values.ts").inherited).toEqual([
      "randomness",
    ]);
    violation("src/core/primitives/destructured-randomness.ts");
    violation("src/core/readings/destructured-values.ts");
  });

  test.each([
    "src/core/compositions/dynamic-eval.ts",
    "src/core/compositions/dynamic-function.ts",
    "src/core/compositions/dynamic-constructor.ts",
  ])("A5: dynamic executable authority stays unresolved at %s", (path) => {
    unresolved(path);
  });

  test("A5: an uncalled raw randomness export grants authority even when consumed as a map callback", () => {
    violation("src/core/primitives/exported-randomness.ts");
    const row = requirements("src/core/primitives/exported-randomness.ts");
    expect(row.direct.length).toBeGreaterThan(0);
    expect(requirements("src/core/readings/mapped-randomness.ts").inherited).toEqual(row.direct);
    violation("src/core/readings/mapped-randomness.ts");
    expect(requirements("src/core/primitives/random-shape.ts")).toMatchObject({
      direct: [],
      inherited: [],
    });
    clear("src/core/primitives/random-shape.ts");
  });

  test.each([
    "src/core/primitives/up-edge.ts",
    "src/core/readings/cycle-one.ts",
    "src/core/readings/outward-edge.ts",
  ])("A1: three-layer placement holds its dependency law at %s", (path) => {
    expect(findings(path)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "R2", status: "violation", blocking: true }),
      ]),
    );
  });
});

describe("readings take data and never acquire production or application authority", () => {
  test("D1: nesting a callback in readonly records does not make it data", () => {
    violation("src/core/readings/nested-callback.ts");
    clear("src/core/readings/data-input.ts");
  });

  test("D2: construction and application are distinct, but carrying a description requires neither", () => {
    expect(requirements("src/core/compositions/write-description.ts").direct).toEqual([
      "cell.produce",
    ]);
    expect(requirements("src/substrate/primitives/apply-description.ts").direct).toEqual([
      "cell.apply",
    ]);
    expect(requirements("src/core/readings/description-target.ts")).toMatchObject({
      direct: [],
      inherited: [],
    });
    clear("src/core/compositions/write-description.ts");
    clear("src/substrate/primitives/apply-description.ts");
    clear("src/core/readings/description-target.ts");
  });

  test("D2: visible unbranded construction and an unchecked cast do not bypass the production boundary", () => {
    violation("src/core/readings/literal-production.ts");
    violation("src/core/readings/cast-production.ts");
  });

  test("D2: explicit and inferred spread reconstructions remain visible production", () => {
    const paths = [
      "src/core/readings/spread-reconstruction.ts",
      "src/core/readings/spread-copy.ts",
      "src/core/readings/inferred-spread.ts",
    ];
    for (const path of paths) {
      expect(findings(path)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rule: "R2", status: "violation", blocking: true }),
        ]),
      );
      expect(findings(path).some((finding) => finding.status === "unresolved")).toBe(false);
    }
    expect(findings(paths[0] ?? "")[0]?.debtKey).not.toBe(findings(paths[1] ?? "")[0]?.debtKey);
  });

  test.each([
    ["D3", "src/substrate/compositions/closure-description.ts"],
    ["C3", "src/substrate/compositions/nested-description.ts"],
  ])(
    "%s: compositions may return authority-bearing closures without a generic return restriction",
    (_id, path) => {
      expect(requirements(path).direct).toContain("cell.apply");
      clear(path);
    },
  );

  test.each([
    ["D4", "src/core/readings/getter-input.ts"],
    ["D5", "src/core/readings/proxy-input.ts"],
    ["D6", "src/core/readings/instance-input.ts"],
  ])("%s: ordinary runtime object shapes do not invent authority entries", (_id, path) => {
    expect(requirements(path)).toMatchObject({ direct: [], inherited: [] });
    clear(path);
  });

  test("C1: a lawful composition inherits production without contaminating its validation reading", () => {
    expect(requirements("src/core/compositions/save-value.ts").inherited).toEqual(["cell.produce"]);
    clear("src/core/compositions/save-value.ts");
    expect(requirements("src/core/readings/valid-value.ts")).toMatchObject({
      direct: [],
      inherited: [],
    });
    clear("src/core/readings/valid-value.ts");
  });

  test("the useful local comparator/map is supported while a supplied reading callback is not", () => {
    for (const path of [
      "src/core/readings/adjusted-limit.ts",
      "src/core/readings/compare-value.ts",
      "src/core/readings/value-order.ts",
    ]) {
      expect(requirements(path)).toMatchObject({ direct: [], inherited: [] });
      clear(path);
    }
    violation("src/core/readings/supplied-comparator.ts");
  });
});

test("C2: absence of authority does not certify the identity wrapper's composition intent", () => {
  expect(requirements("src/core/compositions/value-status.ts")).toMatchObject({
    direct: [],
    inherited: [],
  });
  expect(
    findings("src/core/compositions/value-status.ts").filter((finding) => finding.blocking),
  ).toEqual([]);
  // C2 purpose remains review-held; this test establishes derived authority, not workflow intent.
});

test("C4: a core composition taking a callback is the finding, whatever its callers hand it", () => {
  expect(requirements("src/substrate/compositions/clock-probe.ts").inherited).toContain(
    "clock.read",
  );
  expect(requirements("src/substrate/compositions/pure-probe.ts")).toMatchObject({
    direct: [],
    inherited: [],
  });
  clear("src/substrate/compositions/pure-probe.ts");
  expect(findings("src/core/compositions/run.ts")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ debtKey: "R1:takes-behaviour:src/core/compositions/run.ts:run", blocking: true }),
    ]),
  );
});

test("an unknown package is reported at its import rather than as every call's provenance", () => {
  for (const path of [
    "src/substrate/compositions/unknown-connection.ts",
    "src/core/readings/unknown-provenance.ts",
  ]) {
    expect(findings(path).filter((finding) => finding.status === "unresolved")).toEqual([
      expect.objectContaining({
        status: "unresolved",
        limit: expect.stringMatching(/\S/),
      }),
    ]);
  }
});

test("a package's declared capabilities propagate to consumers; declaring none is explicit", () => {
  for (const capabilities of [["transport.send"], []]) {
    const config = {
      ...fixtureConfig,
      packages: [{ name: "unsupported-library", capabilities }],
    };
    const actual = capabilityCheck(readSnapshot(fixtureRoot, config));
    for (const path of [
      "src/substrate/compositions/unknown-connection.ts",
      "src/core/readings/unknown-provenance.ts",
    ]) {
      expect(
        actual.findings.filter((row) => row.path === path && row.status === "unresolved"),
      ).toEqual([]);
      expect(actual.requirements.find((row) => row.path === path)?.direct).toEqual(capabilities);
    }
    const reader = actual.findings.filter(
      (row) => row.path === "src/core/readings/unknown-provenance.ts",
    );
    if (capabilities.length > 0) {
      expect(reader).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: "violation", blocking: true })]),
      );
    } else {
      expect(reader).toEqual([]);
    }
  }
});

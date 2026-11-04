import { expect, test } from "vitest";
import type { Runs } from "../../src/core/primitives/runs.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { functionGovernance as readGovernance } from "../../src/core/readings/function-governance.js";
import { executionContextOf } from "../../src/core/readings/execution-context.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedFunctions } from "../substrate/compositions/recorded-functions.js";

const module = "src/core/readings/total.ts";
const source =
  "export function total(values: readonly number[]): number {\n" +
  "  return values.reduce((sum, value) => sum + value, 0);\n" +
  "}\n" +
  "export const average = (values: readonly number[]): number => total(values) / values.length;\n" +
  "export const rounding = { half: (value: number): number => Math.round(value * 2) / 2 };\n";

function snapshot(): Snapshot {
  const facts = recordedFunctions({ [module]: source });
  return {
    ...projectSnapshot(facts),
    files: [
      { path: module, type: "source" },
      { path: "oracle/sums/total-sums.test.ts", type: "test" },
      { path: "oracle/sums/rounds-halves.test.ts", type: "test" },
    ],
    claims: [
      { file: "spec/sums.md", anchor: "total-sums", line: 1, terms: ["total"] },
      { file: "spec/sums.md", anchor: "rounds-halves", line: 2, terms: [] },
    ],
  };
}

// These fixtures describe independently recorded runs. Tests of missing/incomplete recording call the
// public reading directly, rather than receiving this fixture's complete context.
function functionGovernance(value: Snapshot, runs: Runs) {
  return readGovernance(value, {
    ...runs,
    contexts: Object.fromEntries(Object.keys(runs.tests).map((test) => [test, {
      complete: true, runtime: "fixture", loaded: [test, module],
    }])),
  });
}

const keys = (runs: Runs): string[] => functionGovernance(snapshot(), runs).map((item) => `${item.debtKey} ${item.fix}`);

test("a module's named functions are recorded with the name a runtime reports, its line and the function holding it", () => {
  expect(recordedFunctions({ [module]: source }).functions?.map(({ name, line, id, holder }) => [name, line, id, holder])).toEqual([
    ["total", 1, "total", null],
    ["average", 4, "average", null],
    ["half", 5, "half", null],
  ]);
});

test("a function a claim naming its module runs is governed; an anonymous function belongs to the one holding it", () => {
  expect(
    keys({ tests: { "oracle/sums/total-sums.test.ts": { [module]: ["total@1", "average@4", "half@5"] } } }),
  ).toEqual([]);
});

test("a function only claims that don't name the module run is debt, and so is one no test runs", () => {
  expect(
    keys({
      tests: {
        "oracle/sums/total-sums.test.ts": { [module]: ["total@1"] },
        "oracle/sums/rounds-halves.test.ts": { [module]: ["half@5"] },
      },
    }),
  ).toEqual([
    `R4:ungoverned-function:${module}:average No independent claim proof runs average: prove it from a claim that names this module, or delete it.`,
    `R4:ungoverned-function:${module}:half Only independent proofs of claims that don't name this module run half: prove it from a claim that names the module.`,
  ]);
  expect(functionGovernance(snapshot(), { tests: {} }).every((item) => item.category === "legacy-debt")).toBe(true);
});

const proof = "oracle/sums/total-sums.test.ts";
const integrated = "oracle/sums/total-sums.browser.test.ts";
const startup = "src/start.ts";
const allFunctions = ["total@1", "average@4", "half@5"];
type Edge = { readonly from: string; readonly to: string; readonly typeOnly?: boolean };

// Both projections contain erased edges, so only compiler-established runtime imports exclude a proof.
function graph(edges: readonly Edge[], fallback = false, declared: readonly string[] = [startup]): Snapshot {
  const base = snapshot();
  const project = base.compiler?.projects[0];
  if (project === undefined) throw new Error("The fixture must retain its recorded functions.");
  const paths = [...new Set([module, proof, integrated, ...edges.flatMap(({ from, to }) => [from, to])])];
  return {
    ...base,
    config: { ...base.config, exceptions: declared },
    files: paths.map((path) => ({ path, type: path.endsWith(".test.ts") ? "test" : "source" })),
    imports: edges.map(({ from, to }) => ({ from, to })),
    compiler: {
      version: "",
      projects: [{
        ...project,
        files: fallback ? [module] : paths,
        imports: fallback ? [] : edges.map(({ from, to, typeOnly }) => ({
          file: from,
          specifier: to,
          target: to,
          typeOnly: typeOnly ?? false,
        })),
      }],
    },
  };
}

test("execution through a declared application entrypoint cannot govern a module", () => {
  const result = functionGovernance(graph([{ from: proof, to: startup }]), {
    tests: { [proof]: { [module]: allFunctions } },
  });
  expect(result.map(({ debtKey }) => debtKey)).toEqual([
    `R4:ungoverned-function:${module}:average`,
    `R4:ungoverned-function:${module}:half`,
    `R4:ungoverned-function:${module}:total`,
  ]);
  expect(result.every(({ fix }) => /independent/i.test(fix))).toBe(true);
});

test("runtime imports follow side effects and legacy helpers without stopping at a cycle", () => {
  const helper = "oracle/legacy/driver.ts";
  const legacy = "src/legacy/bootstrap.ts";
  const result = functionGovernance(graph([
    { from: proof, to: helper },
    { from: helper, to: legacy },
    { from: legacy, to: helper },
    { from: legacy, to: startup },
  ]), { tests: { [proof]: { [module]: allFunctions } } });
  expect(result).toHaveLength(3);
  expect(result.every(({ fix }) => /independent/i.test(fix))).toBe(true);
});

test("independent and integration variants of one claim cannot merge their execution credit", () => {
  const result = functionGovernance(graph([{ from: integrated, to: startup }]), {
    tests: {
      [proof]: { [module]: ["total@1"] },
      [integrated]: { [module]: ["average@4", "half@5"] },
    },
  });
  expect(result.map(({ debtKey }) => debtKey)).toEqual([
    `R4:ungoverned-function:${module}:average`,
    `R4:ungoverned-function:${module}:half`,
  ]);
  expect(result.every(({ fix }) => /independent/i.test(fix))).toBe(true);
});

test("an independent variant may supply all execution while the application journey stays recorded", () => {
  const runs: Runs = { tests: {
    [proof]: { [module]: allFunctions },
    [integrated]: { [module]: allFunctions },
  } };
  const before = JSON.stringify(runs);
  expect(functionGovernance(graph([{ from: integrated, to: startup }]), runs)).toEqual([]);
  expect(JSON.stringify(runs)).toBe(before);
});

test("a compiler-established erased edge to startup does not disqualify a proof", () => {
  expect(functionGovernance(graph([{ from: proof, to: startup, typeOnly: true }]), {
    tests: { [proof]: { [module]: allFunctions } },
  })).toEqual([]);
});

test("a disconnected application graph does not disqualify an independent proof", () => {
  expect(functionGovernance(graph([
    { from: proof, to: module },
    { from: "src/unrelated.ts", to: startup },
  ]), { tests: { [proof]: { [module]: allFunctions } } })).toEqual([]);
});

test("declaring a claim proof as an entrypoint does not make it application startup", () => {
  expect(functionGovernance(graph([{ from: proof, to: module }], false, [startup, proof]), {
    tests: { [proof]: { [module]: allFunctions } },
  })).toEqual([]);
});

test("uncompiled helpers retain fallback import edges into application startup", () => {
  const result = functionGovernance(graph([
    { from: proof, to: "src/legacy/driver.ts" },
    { from: "src/legacy/driver.ts", to: startup },
  ], true), { tests: { [proof]: { [module]: allFunctions } } });
  expect(result).toHaveLength(3);
});

test("an unrelated runtime cycle remains independently provable", () => {
  expect(functionGovernance(graph([
    { from: proof, to: "oracle/legacy/driver.ts" },
    { from: "oracle/legacy/driver.ts", to: "src/legacy/cycle.ts" },
    { from: "src/legacy/cycle.ts", to: "oracle/legacy/driver.ts" },
  ]), { tests: { [proof]: { [module]: allFunctions } } })).toEqual([]);
});

test("old or incomplete execution records cannot establish an independent contract proof", () => {
  const tests = { [proof]: { [module]: allFunctions } };
  expect(readGovernance(graph([]), { tests })).toHaveLength(3);
  expect(readGovernance(graph([]), {
    tests,
    contexts: { [proof]: { complete: false, runtime: "fixture", loaded: [proof, module] } },
  })).toHaveLength(3);
  expect(readGovernance(graph([]), {
    tests,
    contexts: { [proof]: { complete: true, runtime: "fixture", loaded: [proof, module] } },
  })).toEqual([]);
});

test("observed startup disqualifies a proof even when no static import points to the application", () => {
  const base = graph([], false, []);
  const value = { ...base, files: [...base.files, { path: startup, type: "source" as const }], config: { ...base.config, bootstraps: [startup] } };
  expect(readGovernance(value, {
    tests: { [proof]: { [module]: allFunctions } },
    contexts: { [proof]: { complete: true, runtime: "fixture", loaded: [proof, module, startup] } },
  })).toHaveLength(3);
  expect(value.config.exceptions).toEqual([]);
});

test("an explicit bootstrap inventory distinguishes a proof host exception from the application", () => {
  const host = "src/tools/proof-host.ts";
  const base = graph([{ from: proof, to: host }], false, [host]);
  const value = { ...base, files: [...base.files, { path: startup, type: "source" as const }], config: { ...base.config, bootstraps: [startup] } };
  const tests = { [proof]: { [module]: allFunctions } };
  expect(readGovernance(value, { tests, contexts: { [proof]: {
    complete: true, runtime: "fixture", loaded: [proof, module, host],
  } } })).toEqual([]);
  expect(readGovernance(value, { tests, contexts: { [proof]: {
    complete: true, runtime: "fixture", loaded: [proof, module, host, startup],
  } } })).toHaveLength(3);
});

test("a library may explicitly have no application bootstrap while legacy declarations retain their meaning", () => {
  const base = graph([{ from: proof, to: startup }]);
  expect(functionGovernance(base, { tests: { [proof]: { [module]: allFunctions } } })).toHaveLength(3);
  expect(functionGovernance({ ...base, config: { ...base.config, bootstraps: [] } }, {
    tests: { [proof]: { [module]: allFunctions } },
  })).toEqual([]);
});

test("unmapped executable output cannot bypass a bootstrap's original-source identity", () => {
  expect(readGovernance(graph([]), {
    tests: { [proof]: { [module]: allFunctions } },
    contexts: { [proof]: { complete: true, runtime: "fixture", loaded: [proof, module, "dist/index.js"] } },
  })).toHaveLength(3);
});

test("an allegedly complete capture must include both its proof and the code receiving execution credit", () => {
  for (const loaded of [[proof], [module], []]) expect(readGovernance(graph([]), {
    tests: { [proof]: { [module]: allFunctions } },
    contexts: { [proof]: { complete: true, runtime: "fixture", loaded } },
  })).toHaveLength(3);
});

test("malformed stored source identities cannot establish governance", () => {
  const context = executionContextOf({ complete: true, runtime: "fixture", loaded: [proof, module, "../src/start.ts"] });
  expect(context).toBeUndefined();
  expect(readGovernance(graph([]), { tests: { [proof]: { [module]: allFunctions } }, contexts: context === undefined ? {} : { [proof]: context } })).toHaveLength(3);
});

test("one ambiguous name and line cannot govern two distinct functions", () => {
  const text = "export const first = { run: (): number => 1 }; export const second = { run: (): number => 2 };\n";
  const facts = recordedFunctions({ [module]: text });
  const original = snapshot();
  const project = original.compiler?.projects[0];
  if (project === undefined) throw new Error("The fixture must retain its compiler project.");
  const value = { ...original, compiler: { version: "", projects: [{ ...project, ...facts }] } };
  const functions = facts.functions ?? [];
  expect(functions.filter(({ name, line }) => name === "run" && line === 1)).toHaveLength(2);
  const findings = readGovernance(value, {
    tests: { [proof]: { [module]: ["run@1"] } },
    contexts: { [proof]: { complete: true, runtime: "fixture", loaded: [proof, module] } },
  });
  expect(findings.map(({ debtKey }) => debtKey)).toEqual(functions.map(({ id }) => `R4:ungoverned-function:${module}:${id}`).sort());
});

test("an observed helper reaching a bootstrap also prevents independent execution credit", () => {
  const helper = "src/legacy/browser-driver.ts";
  expect(readGovernance(graph([{ from: helper, to: startup }]), {
    tests: { [proof]: { [module]: allFunctions } },
    contexts: { [proof]: { complete: true, runtime: "fixture", loaded: [proof, module, helper] } },
  })).toHaveLength(3);
});

test("a missing unrelated proof does not erase valid independent execution credit", () => {
  expect(readGovernance(snapshot(), {
    tests: { [proof]: { [module]: ["total@1"] } },
    contexts: { [proof]: { complete: true, runtime: "fixture", loaded: [proof, module] } },
  }).map(({ debtKey }) => debtKey)).toEqual([
    `R4:ungoverned-function:${module}:average`,
    `R4:ungoverned-function:${module}:half`,
  ]);
});

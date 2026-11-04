import { expect, test } from "vitest";
import type { InvocationEvidence } from "../../src/core/primitives/invocation-evidence.js";
import { invocationPasses, invocationText } from "../../src/core/readings/invocation-passes.js";
import { keptRuns, runtimeOf, verdictOf } from "../../src/core/readings/verdict-reuse.js";

const root = "/app";
const runtime = "runtime";
const scripts = "scripts";
const proof = "oracle/sums/sums.test.ts";
const command = "node test.mjs";
const commands = new Map([[proof, command]]);
const pass = {
  check: `test:${proof}`, seconds: 1, states: { "src/core/readings/sum.ts": "file:current" },
  ran: { "src/core/readings/sum.ts": ["sum@1"] },
  execution: { complete: true, runtime: runtimeOf(command, runtime, scripts), loaded: [proof, "src/core/readings/sum.ts"] },
};
const publicPass = { check: pass.check, states: pass.states, ran: pass.ran, execution: pass.execution };
const evidence: InvocationEvidence = { version: 1, root, runtime, scripts, tests: { [proof]: { command, verdict: publicPass } } };

test("invocation evidence preserves attributable passing tests without requiring persistent storage", () => {
  expect(invocationPasses(JSON.stringify(evidence), root, runtime, scripts, commands)).toEqual(new Map([[proof, { ...pass, seconds: 0 }]]));
  const source = keptRuns(new Map([[proof, pass], ["oracle/other/missing.test.ts", undefined]]));
  expect(source.waiting).toEqual(["oracle/other/missing.test.ts"]);
  expect(source.runs.tests).toEqual({ [proof]: pass.ran });
  expect(source.runs.contexts).toEqual({ [proof]: pass.execution });
});

test("foreign or malformed invocation envelopes fail instead of falling back to stored passes", () => {
  for (const changed of [
    { ...evidence, version: 2 }, { ...evidence, root: "/another" }, { ...evidence, runtime: "other" },
    { ...evidence, scripts: "changed" }, { ...evidence, tests: [] },
  ]) expect(() => invocationPasses(JSON.stringify(changed), root, runtime, scripts, commands)).toThrow();
  expect(() => invocationPasses("not-json", root, runtime, scripts, commands)).toThrow();
});

test("a test's command, identity and execution runtime must match the current invocation", () => {
  for (const entry of [
    { command: "node another.mjs", verdict: publicPass },
    { command, verdict: { ...publicPass, check: "test:oracle/other/proves.test.ts" } },
    { command, verdict: { ...publicPass, execution: { ...pass.execution, runtime: "foreign" } } },
    { command, verdict: { ...publicPass, states: { file: 1 } } },
  ]) expect(() => invocationPasses(JSON.stringify({ ...evidence, tests: { [proof]: entry } }), root, runtime, scripts, commands)).toThrow();
});

test("unknown or unassigned test identities cannot enter invocation evidence", () => {
  expect(() => invocationPasses(JSON.stringify({ ...evidence, tests: { ...evidence.tests, "tests/unrelated.test.ts": { malformed: true } } }), root, runtime, scripts, commands)).toThrow();
  expect(invocationPasses(JSON.stringify({ ...evidence, tests: {} }), root, runtime, scripts, commands)).toEqual(new Map());
});

test("public invocation input excludes elapsed diagnostics while persistent verdicts retain them", () => {
  const diagnostic = { ...pass, seconds: 99 };
  const first = invocationText({ ...evidence, tests: { [proof]: { command, verdict: pass } } });
  const later = invocationText({ ...evidence, tests: { [proof]: { command, verdict: diagnostic } } });
  expect(first).toBe(later);
  expect(JSON.parse(first).tests[proof].verdict).not.toHaveProperty("seconds");
  expect(verdictOf(JSON.stringify(pass))?.seconds).toBe(1);
  expect(() => invocationPasses(JSON.stringify({ ...evidence, tests: { [proof]: { command, verdict: pass } } }), root, runtime, scripts, commands)).toThrow();
});

test("canonical invocation input is stable under map ordering and sensitive to every offered proof component", () => {
  const offered = { ...publicPass, states: { a: "file:a", b: "file:b" }, ran: { module: ["one@1", "two@2"] } };
  const original = invocationText({ ...evidence, tests: { [proof]: { command, verdict: offered } } });
  const reordered = { ...offered, states: { b: "file:b", a: "file:a" }, ran: { module: ["two@2", "one@1", "one@1"] }, execution: { ...offered.execution, loaded: [...offered.execution.loaded].reverse() } };
  expect(invocationText({ ...evidence, tests: { [proof]: { command, verdict: reordered } } })).toBe(original);
  for (const changed of [
    { command: "node changed.mjs", verdict: offered },
    { command, verdict: { ...offered, states: { a: "file:changed", b: "file:b" } } },
    { command, verdict: { ...offered, ran: { module: ["one@1"] } } },
    { command, verdict: { ...offered, execution: { ...offered.execution, complete: false } } },
    { command, verdict: { ...offered, execution: { ...offered.execution, loaded: [proof] } } },
  ]) expect(invocationText({ ...evidence, tests: { [proof]: changed } })).not.toBe(original);
  expect(invocationText({ ...evidence, tests: {} })).not.toBe(original);
});

test("unsupported public fields cannot become hidden inputs of a post-test check", () => {
  for (const changed of [
    { ...evidence, seconds: 1 },
    { ...evidence, tests: { [proof]: { command, seconds: 1, verdict: publicPass } } },
    { ...evidence, tests: { [proof]: { command, verdict: { ...publicPass, seconds: 1 } } } },
    { ...evidence, tests: { [proof]: { command, verdict: { ...publicPass, execution: { ...publicPass.execution, seconds: 1 } } } } },
  ]) expect(() => invocationPasses(JSON.stringify(changed), root, runtime, scripts, commands)).toThrow();
});

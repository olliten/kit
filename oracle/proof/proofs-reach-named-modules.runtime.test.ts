import { expect, test } from "vitest";
import { proofReach } from "../../src/core/readings/proof-reach.js";
import { runtimeReach } from "../../src/core/readings/runtime-reach.js";
import type { Runs } from "../../src/core/primitives/runs.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const PROOF = "oracle/topic/idle-search.browser.test.ts";
const MODULE = "src/shell/compositions/search-idle.ts";
const CLAIM = { file: "spec/topic.md", anchor: "idle-search", line: 1, terms: ["search-idle"] };
const parts: Parameters<typeof snapshotOf>[0] = { files: [MODULE, PROOF], imports: [], claims: [CLAIM] };
const ran = (complete: boolean): Runs => ({
  tests: { [PROOF]: { [MODULE]: ["idle@3"] } },
  contexts: { [PROOF]: { complete, runtime: "r", loaded: [PROOF, MODULE] } },
});
const keys = (runs?: Runs) =>
  proofReach({ ...snapshotOf(parts), ...(runs === undefined ? {} : { runs }) }).map((finding) => finding.debtKey);

test("a test with no run, or a run in an incomplete context, reaches nothing by running", () => {
  expect([...runtimeReach(snapshotOf(parts), undefined).reached]).toEqual([]);
  expect([...runtimeReach(snapshotOf(parts), ran(false)).reached.get("spec/topic.md:idle-search") ?? []]).toEqual([]);
});

test("a named module a test ran a function of in a complete context is reached, though no import leads there", () => {
  expect(keys()).toEqual(["R4:unreached-module:spec/topic.md:idle-search:search-idle"]);
  expect(keys(ran(true))).toEqual([]);
  expect(keys(ran(false))).toEqual(["R4:unreached-module:spec/topic.md:idle-search:search-idle"]);
});

test("while a recording test of the claim has no kept run, what running would reach waits", () => {
  const waiting: Runs = { tests: {}, contexts: {}, waiting: [PROOF] };
  expect(keys(waiting)).toEqual([]);
  expect([...runtimeReach(snapshotOf(parts), waiting).waiting]).toEqual(["spec/topic.md:idle-search"]);
  // A test whose command records nothing brings no run, so its claim's static reach is all there is.
  expect(keys({ tests: {}, contexts: {} })).toEqual(["R4:unreached-module:spec/topic.md:idle-search:search-idle"]);
});

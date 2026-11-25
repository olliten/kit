import { expect, test } from "vitest";
import { runtimeReach } from "../../src/core/readings/runtime-reach.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const snapshot = snapshotOf({
  files: ["src/shell/compositions/search-idle.ts", "oracle/topic/idle-search.browser.test.ts"],
  imports: [],
});

test("a test with no run, or a run in an incomplete context, reaches nothing by running", () => {
  expect([...runtimeReach(snapshot, undefined)]).toEqual([]);
  expect([...runtimeReach(snapshot, {
    tests: { "oracle/topic/idle-search.browser.test.ts": { "src/shell/compositions/search-idle.ts": ["idle@3"] } },
    contexts: { "oracle/topic/idle-search.browser.test.ts": { complete: false, runtime: "r", loaded: ["src/shell/compositions/search-idle.ts"] } },
  })]).toEqual([]);
});

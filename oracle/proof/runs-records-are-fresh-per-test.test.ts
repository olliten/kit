import { expect, test } from "vitest";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { recordPathOf } from "../../src/core/readings/runs-freshness.js";
import { runsRecord } from "../../src/core/readings/runs-record.js";
import { snapshotOf } from "../core/readings/fixture-snapshot.js";

const sums = "oracle/sums/total-sums.test.ts";
const rounds = "oracle/sums/rounds-down.test.ts";
const total = "src/core/readings/total.ts";
const round = "src/core/readings/round.ts";
const recordOf = (test: string, digests: Record<string, string>, ran: Record<string, string[]> = {}) => ({
  path: recordPathOf("kit/runs", test),
  text: JSON.stringify({ test, digests, ran }),
});

function snapshot(records: readonly { path: string; text: string }[], digests: Record<string, string> = {}, imports: string[] = []): Snapshot {
  const base = snapshotOf({ files: [total, round, sums, rounds], imports: [`${sums} > ${total}`, `${rounds} > ${round}`, ...imports] });
  const current: Record<string, string> = { [total]: "t", [round]: "r", [sums]: "s", [rounds]: "d", ...digests };
  return {
    ...base,
    config: { ...base.config, runs: { record: "kit/runs", each: "run {test} {dir}" } },
    files: base.files.map((file) => ({ ...file, digest: current[file.path] ?? "" })),
    runsRecords: records,
  };
}
const fresh = [
  recordOf(sums, { [sums]: "s", [total]: "t" }, { [total]: ["total@1"] }),
  recordOf(rounds, { [rounds]: "d", [round]: "r" }, { [round]: ["round@1"] }),
];
const keys = (state: Snapshot) => runsRecord(state).findings.map((item) => item.debtKey);

test("a test's record is named by its path", () => {
  expect(recordPathOf("kit/runs", "oracle/a/b.c.test.ts")).toBe("kit/runs/oracle+a+b.c.test.ts.json");
});

test("fresh records are read together as what each test ran", () => {
  expect(runsRecord(snapshot(fresh))).toEqual({
    runs: { tests: { [rounds]: { [round]: ["round@1"] }, [sums]: { [total]: ["total@1"] } } },
    findings: [],
  });
});

test("a record is stale when a file it depends on changed, and only that record", () => {
  const state = snapshot(fresh, { [total]: "edited" });
  expect(keys(state)).toEqual([`R4:runs-stale:${recordPathOf("kit/runs", sums)}`]);
  expect(runsRecord(state).findings[0]?.fix).toContain(total);
  expect(runsRecord(state).runs).toBeNull();
  expect(keys(snapshot(fresh, { [sums]: "edited" }))).toEqual([`R4:runs-stale:${recordPathOf("kit/runs", sums)}`]);
});

test("a record is stale when its test now reaches a file the record doesn't hold", () => {
  expect(keys(snapshot(fresh, {}, [`${total} > ${round}`]))).toEqual([`R4:runs-stale:${recordPathOf("kit/runs", sums)}`]);
});

test("a missing, unreadable, mismatched or orphaned record is a finding on its file", () => {
  expect(keys(snapshot([fresh[0]!]))).toEqual([`R4:runs-missing:${recordPathOf("kit/runs", rounds)}`]);
  expect(keys(snapshot([fresh[0]!, { path: recordPathOf("kit/runs", rounds), text: "{" }]))).toEqual([
    `R4:runs-unreadable:${recordPathOf("kit/runs", rounds)}`,
  ]);
  expect(keys(snapshot([fresh[0]!, { path: recordPathOf("kit/runs", rounds), text: fresh[0]!.text }]))).toEqual([
    `R4:runs-unreadable:${recordPathOf("kit/runs", rounds)}`,
  ]);
  const gone = recordOf("oracle/sums/gone.test.ts", {});
  expect(keys(snapshot([...fresh, gone]))).toEqual([`R4:runs-orphan:${gone.path}`]);
});

test("a placed module no record mentions is not stale, and an app without runs reads none", () => {
  const state = snapshot(fresh);
  expect(runsRecord({ ...state, files: [...state.files, { path: "src/core/readings/new.ts", type: "source", digest: "n" }] }).findings).toEqual([]);
  const { runs: _, ...undeclared } = state.config;
  expect(runsRecord({ ...state, config: undeclared })).toEqual({ runs: null, findings: [] });
});

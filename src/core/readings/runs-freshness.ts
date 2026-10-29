import type { TestRecord } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { placementOf } from "./placement-of.js";
import { testReachOf } from "./proof-reach.js";

export type RecordStatus = "fresh" | "missing" | "unreadable" | "stale";

export interface RecordState {
  readonly test: string;
  readonly path: string;
  readonly status: RecordStatus;
  readonly record?: TestRecord;
  readonly changed: readonly string[];
}

// A test's record file, named by its path. A proof path holds only word characters, dashes, dots and slashes, so
// no two tests share a name.
export const recordPathOf = (directory: string, test: string): string => `${directory}/${test.replaceAll("/", "+")}.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTextMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === "string");
const isListMap = (value: unknown): value is Record<string, string[]> =>
  isRecord(value) && Object.values(value).every((item) => Array.isArray(item) && item.every((each) => typeof each === "string"));

function recordOf(text: string, test: string): TestRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed["test"] !== test || !isTextMap(parsed["digests"]) || !isListMap(parsed["ran"])) return null;
  return { test, digests: parsed["digests"], ran: parsed["ran"] };
}

// The files a test's record depends on: the test and the placed files its code reaches. What it ran is added when
// the record is written.
export function recordInputs(snapshot: Snapshot): (test: string) => string[] {
  const { srcRoot, layerNames, oracleRoot } = snapshot.config;
  const covered = new Set(
    snapshot.files
      .filter(
        (file) =>
          (file.type === "test" && file.path.startsWith(`${oracleRoot}/`)) ||
          (file.type === "source" && placementOf(file.path, srcRoot, layerNames).placed),
      )
      .map((file) => file.path),
  );
  const reach = testReachOf(snapshot);
  return (test) => [...new Set([test, ...[...reach(test)].filter((path) => covered.has(path))])].sort();
}

// Each proof-root test's record and whether it still describes the code: it is stale when a file it depends on no
// longer has its recorded digest, or the test now reaches a file the record doesn't hold. A record whose test is
// gone is an orphan.
export function runsFreshness(snapshot: Snapshot): { readonly records: readonly RecordState[]; readonly orphans: readonly string[] } {
  const directory = snapshot.config.runs?.record;
  if (directory === undefined) return { records: [], orphans: [] };
  const { oracleRoot } = snapshot.config;
  const digests = new Map<string, string>();
  for (const file of snapshot.files) if (file.digest !== undefined) digests.set(file.path, file.digest);
  const texts = new Map((snapshot.runsRecords ?? []).map((file) => [file.path, file.text]));
  const inputs = recordInputs(snapshot);
  const tests = snapshot.files
    .filter((file) => file.type === "test" && file.path.startsWith(`${oracleRoot}/`))
    .map((file) => file.path)
    .sort();
  const expected = new Set(tests.map((test) => recordPathOf(directory, test)));
  const records = tests.map((test): RecordState => {
    const path = recordPathOf(directory, test);
    const text = texts.get(path);
    if (text === undefined) return { test, path, status: "missing", changed: [] };
    const record = recordOf(text, test);
    if (record === null) return { test, path, status: "unreadable", changed: [] };
    const changed = [
      ...Object.entries(record.digests)
        .filter(([file, digest]) => digests.get(file) !== digest)
        .map(([file]) => file),
      ...inputs(test).filter((file) => !(file in record.digests)),
    ].sort();
    return { test, path, status: changed.length === 0 ? "fresh" : "stale", record, changed };
  });
  return { records, orphans: [...texts.keys()].filter((path) => !expected.has(path)).sort() };
}

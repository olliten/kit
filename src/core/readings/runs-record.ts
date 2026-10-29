import type { Runs } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, finding } from "./finding.js";
import { runsFreshness } from "./runs-freshness.js";

// The records `kit runs` wrote, while each still describes the code. A missing, unreadable or stale record, and a
// record whose test is gone, is a finding on that record's file, and the rules that read the records wait until
// `kit runs` records again, since partial runs would show the stale tests' functions as unrun.
export function runsRecord(snapshot: Snapshot): { readonly runs: Runs | null; readonly findings: readonly Finding[] } {
  if (snapshot.config.runs === undefined) return { runs: null, findings: [] };
  const { records, orphans } = runsFreshness(snapshot);
  const findings: Finding[] = [];
  for (const { test, path, status, changed } of records) {
    if (status === "missing")
      findings.push(finding("R4", "runs-missing", path, `Run \`kit runs --stale\` to record what ${test} runs, and commit the record.`));
    if (status === "unreadable")
      findings.push(finding("R4", "runs-unreadable", path, `Run \`kit runs --stale\` to record ${test} again, and commit the record.`));
    if (status === "stale")
      findings.push(
        finding("R4", "runs-stale", path, `${changed.join(", ")} changed since ${test} was recorded: run \`kit runs --stale\` and commit the record.`),
      );
  }
  for (const path of orphans)
    findings.push(finding("R4", "runs-orphan", path, "This record's test is gone: run `kit runs --stale` to remove it, and commit."));
  if (findings.length > 0) return { runs: null, findings };
  return { runs: { tests: Object.fromEntries(records.flatMap(({ test, record }) => (record === undefined ? [] : [[test, record.ran]]))) }, findings };
}

import type { Runs } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { claimRuns } from "./claim-runs.js";
import { type Finding, byDebtKey, finding } from "./finding.js";

export interface GovernanceFinding extends Finding {
  readonly category: "legacy-debt";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
}

// Every named function of a placed module is run by a test of a claim that names the module. One none of
// them runs is governed by no claim that promises anything about it: proved only incidentally, or not at all.
export function functionGovernance(snapshot: Snapshot, runs: Runs): GovernanceFinding[] {
  const findings: GovernanceFinding[] = [];
  for (const { module, functions, naming, ran } of claimRuns(snapshot, runs)) {
    const governed = new Set([...ran].filter(([claim]) => naming.has(claim)).flatMap(([, ids]) => [...ids]));
    const incidental = new Set([...ran].filter(([claim]) => !naming.has(claim)).flatMap(([, ids]) => [...ids]));
    for (const fact of functions)
      if (!governed.has(fact.id))
        findings.push({
          ...finding(
            "R4",
            "ungoverned-function",
            module,
            incidental.has(fact.id)
              ? `Only claims that don't name this module run ${fact.name}: prove it from a claim that names the module.`
              : `No test runs ${fact.name}: prove it from a claim that names this module, or delete it.`,
            fact.id,
          ),
          category: "legacy-debt",
          status: "violation",
          blocking: true,
          limit: "",
        });
  }
  return findings.sort(byDebtKey);
}

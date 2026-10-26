import type { Runs } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { claimRuns } from "./claim-runs.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf } from "./placement-of.js";

export interface ExcerptFinding extends Finding {
  readonly category: "legacy-debt";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
}

// Claims that share a module share its code. A named function only one claim's tests run, held by no named
// function other claims run, is that claim's excerpt; a module holding the excerpts of two or more claims is
// several modules. An adapter is defined by its operations, so it is exempt.
export function excerptCohesion(snapshot: Snapshot, runs: Runs): ExcerptFinding[] {
  const { srcRoot, layerNames } = snapshot.config;
  const findings: ExcerptFinding[] = [];
  for (const { module, functions, ran } of claimRuns(snapshot, runs)) {
    const at = placementOf(module, srcRoot, layerNames);
    if (at.placed && at.layer === "adapters") continue;
    const owners = new Map<string, string[]>();
    for (const [claim, ids] of ran) for (const id of ids) owners.set(id, [...(owners.get(id) ?? []), claim]);
    const holderOf = new Map(functions.map((fact) => [fact.id, fact.holder]));
    const sharedAbove = (id: string): boolean => {
      for (let holder = holderOf.get(id) ?? null; holder !== null; holder = holderOf.get(holder) ?? null)
        if ((owners.get(holder)?.length ?? 0) > 1) return true;
      return false;
    };
    const excerpts = new Map<string, string[]>();
    for (const [id, claims] of owners) {
      const claim = claims[0];
      if (claims.length !== 1 || claim === undefined || sharedAbove(id)) continue;
      excerpts.set(claim, [...(excerpts.get(claim) ?? []), id]);
    }
    if (excerpts.size < 2) continue;
    const described = [...excerpts]
      .map(([claim, ids]) => `${claim.slice(claim.lastIndexOf(":") + 1)} (${ids.sort().join(", ")})`)
      .sort();
    findings.push({
      ...finding(
        "R4",
        "excerpt-cohesion",
        module,
        `These claims each run code of this module no other claim runs: ${described.join("; ")}. Move each claim's excerpt into its own module.`,
      ),
      category: "legacy-debt",
      status: "violation",
      blocking: true,
      limit: "",
    });
  }
  return findings.sort(byDebtKey);
}

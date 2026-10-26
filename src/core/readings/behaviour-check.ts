import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf } from "./placement-of.js";

export interface BehaviourFinding extends Finding {
  readonly category: "placed-violation";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
}

// The core decides and a reading derives, so neither takes behaviour: what they are handed is data, or a
// registered adapter's contract, whose capability the zone rules then check.
export function behaviourCheck(snapshot: Snapshot): BehaviourFinding[] {
  const { srcRoot, layerNames } = snapshot.config;
  const findings = new Map<string, BehaviourFinding>();
  for (const symbol of (snapshot.compiler?.projects ?? []).flatMap((project) => project.exports)) {
    const at = placementOf(symbol.file, srcRoot, layerNames);
    if (symbol.acceptsBehaviour !== true || !at.placed || (at.zone !== "core" && at.layer !== "readings")) continue;
    const item = {
      ...finding(
        "R1",
        "takes-behaviour",
        symbol.file,
        "Take data here, or a registered adapter's contract; keep supplied behaviour in compositions outside the core.",
        symbol.name,
      ),
      category: "placed-violation" as const,
      status: "violation" as const,
      blocking: true as const,
      limit: "" as const,
    };
    findings.set(item.debtKey, item);
  }
  return [...findings.values()].sort(byDebtKey);
}

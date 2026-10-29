import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { legacyCodeOf, placementOf, proofOf, rootOf } from "./placement-of.js";

export interface HandoverFinding extends Finding {
  readonly category: "legacy-debt" | "proof-debt" | "placed-violation";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
}

// Code outside the zones, legacy or an entrypoint, hands placed code data or a registered adapter's
// contract, never other behaviour: a callable from there carries authority no check has established, so what
// may cross is decided where it imports placed code, not by following each value it hands on.
export function handoverCheck(snapshot: Snapshot): HandoverFinding[] {
  const { srcRoot, exceptions = [], layout, oracleRoot } = snapshot.config;
  const outside = (file: string): boolean =>
    (rootOf(file, srcRoot) !== undefined || legacyCodeOf(file, layout?.legacy)) &&
    !placementOf(file, srcRoot).placed;
  const projects = snapshot.compiler?.projects ?? [];
  const behaviour = new Map<string, string[]>();
  for (const { file, name, acceptsBehaviour } of projects.flatMap((project) => project.exports))
    if (acceptsBehaviour === true) behaviour.set(file, [...new Set([...(behaviour.get(file) ?? []), name])]);
  const findings = new Map<string, HandoverFinding>();
  for (const edge of projects.flatMap((project) => project.imports)) {
    const target = edge.target;
    if (edge.typeOnly || target === null || !outside(edge.file) || !placementOf(target, srcRoot).placed) continue;
    const accepting = behaviour.get(target) ?? [];
    for (const name of edge.namedImports?.filter((named) => accepting.includes(named)) ?? accepting) {
      const item = {
        ...finding(
          "R1",
          "handover",
          edge.file,
          `${target} exports ${name}, which takes behaviour; hand placed code data or an adapter's contract.`,
          `${target}#${name}`,
        ),
        category: proofOf(edge.file, oracleRoot) !== null
          ? ("proof-debt" as const)
          : exceptions.includes(edge.file)
            ? ("placed-violation" as const)
            : ("legacy-debt" as const),
        status: "violation" as const,
        blocking: true as const,
        limit: "" as const,
      };
      findings.set(item.debtKey, item);
    }
  }
  return [...findings.values()].sort(byDebtKey);
}

import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { legacyCodeOf, placementOf, rootOf } from "./placement-of.js";

export interface LegacyBoundaryFinding extends Finding {
  readonly category: "legacy-debt";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
}

// Legacy hands placed code data, never behaviour. A legacy callable carries authority no check has established,
// so what may cross is decided where legacy imports placed code, not by following each value it hands on.
export function legacyBoundary(snapshot: Snapshot): LegacyBoundaryFinding[] {
  const { srcRoot, exceptions = [], layout } = snapshot.config;
  const legacy = (file: string): boolean =>
    (rootOf(file, srcRoot) !== undefined || legacyCodeOf(file, layout?.legacy)) &&
    !placementOf(file, srcRoot).placed &&
    !exceptions.includes(file);
  const projects = snapshot.compiler?.projects ?? [];
  const behaviour = new Map<string, string[]>();
  for (const { file, name, acceptsBehaviour } of projects.flatMap((project) => project.exports))
    if (acceptsBehaviour === true) behaviour.set(file, [...new Set([...(behaviour.get(file) ?? []), name])]);
  const findings = new Map<string, LegacyBoundaryFinding>();
  for (const edge of projects.flatMap((project) => project.imports)) {
    const target = edge.target;
    if (edge.typeOnly || target === null || !legacy(edge.file) || !placementOf(target, srcRoot).placed) continue;
    const accepting = behaviour.get(target) ?? [];
    for (const name of edge.namedImports?.filter((named) => accepting.includes(named)) ?? accepting) {
      const item = {
        ...finding(
          "R1",
          "legacy-behaviour",
          edge.file,
          `${target} exports ${name}, which takes behaviour; hand placed code only data, or place this caller.`,
          `${target}#${name}`,
        ),
        category: "legacy-debt" as const,
        status: "violation" as const,
        blocking: true as const,
        limit: "" as const,
      };
      findings.set(item.debtKey, item);
    }
  }
  return [...findings.values()].sort(byDebtKey);
}

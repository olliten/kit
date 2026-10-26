import type { Snapshot } from "../primitives/snapshot.js";
import { authorityGraph } from "./authority-graph.js";
import { behaviourCheck } from "./behaviour-check.js";
import { type CapabilityFinding, capabilityContext, layerConfigLimit } from "./capability-context.js";
import { compilerCheck } from "./compiler-check.js";
import { constructionCheck } from "./construction-check.js";
import { byDebtKey } from "./finding.js";
import { registrationCheck } from "./registration-check.js";
import { startupCheck } from "./startup-check.js";
import { zoneAuthorityCheck } from "./zone-authority-check.js";

export type { CapabilityFinding } from "./capability-context.js";

export interface CapabilityResult {
  readonly requirements: readonly {
    readonly path: string;
    readonly direct: readonly string[];
    readonly inherited: readonly string[];
  }[];
  readonly findings: readonly CapabilityFinding[];
}

// Every authority rule over one snapshot, and what each checked file directly and transitively requires.
export function capabilityCheck(snapshot: Snapshot): CapabilityResult {
  const layerLimit = layerConfigLimit(snapshot);
  if (layerLimit !== undefined) return { requirements: [], findings: [layerLimit] };
  const { startups, findings: startupFindings } = startupCheck(snapshot);
  const context = capabilityContext(snapshot, startups);
  const { graph, findings: graphFindings } = authorityGraph(snapshot, context);
  const findings = [
    ...startupFindings,
    ...registrationCheck(snapshot, context),
    ...compilerCheck(snapshot, context),
    ...graphFindings,
    ...zoneAuthorityCheck(snapshot, context, graph),
    ...behaviourCheck(snapshot),
    ...constructionCheck(snapshot, context.startups),
  ];
  return {
    requirements: [...graph.inherited].map(([path, capabilities]) => ({
      path,
      direct: [...(graph.direct.get(path) ?? [])].sort(),
      inherited: [...capabilities].sort(),
    })),
    findings: [...new Map(findings.map((result) => [`${result.debtKey}:${result.path}`, result])).values()].sort(byDebtKey),
  };
}

import type { KitConfig } from "../primitives/default-config.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { capabilityCheck } from "./capability-check.js";
import { claimCohesion } from "../readings/claim-cohesion.js";
import { claimProofBinder } from "../readings/claim-proof-binder.js";
import { commentCheck } from "../readings/comment-check.js";
import { dependencyExclusions } from "../readings/dependency-exclusions.js";
import { type Finding, byDebtKey } from "../readings/finding.js";
import { forwarderCheck } from "../readings/forwarder-check.js";
import { handoverCheck } from "../readings/handover-check.js";
import { layoutCheck } from "../readings/layout-check.js";
import { legacySize } from "../readings/legacy-size.js";
import { moduleReferences } from "../readings/module-references.js";
import { nameCheck } from "../readings/name-check.js";
import { placementOf, proofOf } from "../readings/placement-of.js";
import { proofReach } from "../readings/proof-reach.js";
import { proofScope } from "../readings/proof-scope.js";
import { excerptCohesion } from "../readings/excerpt-cohesion.js";
import { functionGovernance } from "../readings/function-governance.js";
import { type GateFinding, startupCheckRoots, withProofDebt } from "../readings/ratchet.js";
import { referenceCheck } from "../readings/semantic-references.js";
import { termModel } from "../readings/term-model.js";
import { termOrder } from "../readings/term-order.js";
import { topicShape } from "../readings/topic-shape.js";

export interface GateResult {
  readonly findings: readonly GateFinding[];
  readonly placedPaths: readonly string[];
  readonly imports: readonly { readonly from: string; readonly to: string }[];
  readonly requiredLimits: readonly GateFinding[];
}

const violation = (item: Finding): GateFinding => ({
  ...item,
  category: "placed-violation",
  status: "violation",
  blocking: true,
  limit: "",
});
const limit = (item: Finding): GateFinding => ({
  ...item,
  category: "checker-limit",
  status: "unresolved",
  blocking: true,
  limit: item.fix,
});

// Every rule's findings on one snapshot, with what the ratchet needs to judge them: the placed modules and the
// runtime imports their limits are reached through. A limit only claim proofs reach is already their debt. A legacy claim without module rows stays outside the
// claim checks.
export function gate(snapshot: Snapshot, config: KitConfig): GateResult {
  const exclusions = dependencyExclusions(snapshot);
  const concepts = termModel(snapshot);
  const topicSnapshot = {
    ...snapshot,
    claims: (snapshot.claims ?? []).filter(
      (claim) =>
        !(config.legacyAreas ?? []).includes(claim.file) || claim.implementation !== undefined || claim.proof !== undefined,
    ),
  };
  const structural = [
    ...exclusions.findings,
    ...[
      ...moduleReferences(topicSnapshot),
      ...claimProofBinder(topicSnapshot),
      ...proofReach(topicSnapshot),
      ...claimCohesion(topicSnapshot),
    ].sort(byDebtKey),
    ...nameCheck(snapshot),
    ...commentCheck(snapshot),
    ...referenceCheck(snapshot),
    ...topicShape(snapshot),
    ...termOrder(snapshot),
    ...concepts.findings,
  ].map(violation);
  const requiredLimits = exclusions.limits.map(limit);
  // Which named functions each test ran, from the passes that still hold.
  const runs = snapshot.runs === undefined ? [] : [...functionGovernance(topicSnapshot, snapshot.runs), ...excerptCohesion(topicSnapshot, snapshot.runs)];
  const placedPaths = snapshot.files
    .filter((file) => file.type === "source" && placementOf(file.path, config.srcRoot).placed)
    .map((file) => file.path);
  const imports = (snapshot.compiler?.projects ?? []).flatMap((project) =>
    project.imports.flatMap((edge) =>
      edge.typeOnly || edge.target === null ? [] : [{ from: edge.file, to: edge.target }],
    ),
  );
  const proofs = snapshot.files
    .filter((file) => file.type === "test" && proofOf(file.path, config.oracleRoot) !== null)
    .map((file) => file.path);
  const findings: GateFinding[] = [
      ...capabilityCheck(snapshot).findings,
      ...legacySize(snapshot),
      ...forwarderCheck(snapshot),
      ...layoutCheck(snapshot),
      ...handoverCheck(snapshot),
      ...proofScope(topicSnapshot),
      ...runs,
      ...structural,
      ...concepts.limits.map(limit),
      ...requiredLimits,
  ];
  return {
    findings: withProofDebt(findings, placedPaths, imports, startupCheckRoots(config), proofs),
    placedPaths,
    imports,
    requiredLimits,
  };
}

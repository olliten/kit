import type { Snapshot } from "../../../src/core/primitives/snapshot.js";
import { claimProofBinder } from "../../../src/core/readings/claim-proof-binder.js";
import { type Finding, byDebtKey } from "../../../src/core/readings/finding.js";
import { moduleReferences } from "../../../src/core/readings/module-references.js";

export function bindingFindings(snapshot: Snapshot): Finding[] {
  return [...moduleReferences(snapshot), ...claimProofBinder(snapshot)].sort(byDebtKey);
}

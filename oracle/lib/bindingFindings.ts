import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { claimProofBinder } from "../../src/core/readings/claim-proof-binder.js";
import { type Finding, byDebtKey } from "../../src/core/readings/finding.js";
import { moduleBinder } from "../../src/core/readings/module-binder.js";

export function bindingFindings(snapshot: Snapshot): Finding[] {
  return [...moduleBinder(snapshot), ...claimProofBinder(snapshot)].sort(byDebtKey);
}

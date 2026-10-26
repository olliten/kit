import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, finding } from "./finding.js";

// The terms file lists each section's terms alphabetically, so concurrent additions edit different lines.
export function termOrder(snapshot: Snapshot): Finding[] {
  return (snapshot.termOrder ?? []).map(({ term, line, detail }) =>
    finding("R3", "term-order", term, detail, String(line)),
  );
}

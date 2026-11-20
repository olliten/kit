import type { Snapshot } from "../primitives/snapshot.js";
import type { CapabilityContext, CapabilityFinding } from "./capability-context.js";

// The type assertions registered refinement constructors may hold, each by its file and site, and a finding for
// each registration that is not a constructor of a branded result whose assertion is reached only past a runtime
// check and which a test calls directly. Until the check is written, no assertion is allowed and none is judged.
export function refinementCheck(
  _snapshot: Snapshot,
  _context: CapabilityContext,
): { readonly allowed: ReadonlySet<string>; readonly findings: readonly CapabilityFinding[] } {
  return { allowed: new Set(), findings: [] };
}

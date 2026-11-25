import type { Runs } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";

// Reach by running: the placed modules a claim's tests ran a named function of in a complete context. Until
// the work fills it, it reaches nothing, so the static reach stays the whole of what proves a claim's names.
export function runtimeReach(snapshot: Snapshot, runs: Runs | undefined): Map<string, Set<string>> {
  void snapshot;
  void runs;
  return new Map();
}

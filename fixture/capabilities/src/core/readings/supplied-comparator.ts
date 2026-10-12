import type { ScoredValue } from "../primitives/scored-value.js";

export function valueOrder(
  values: readonly ScoredValue[],
  compare: (left: ScoredValue, right: ScoredValue) => number,
): readonly string[] {
  return [...values].sort(compare).map((value) => value.id);
}

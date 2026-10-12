import type { ScoredValue } from "../primitives/scored-value.js";
import { compareValue } from "./compare-value.js";

export function valueOrder(values: readonly ScoredValue[]): readonly string[] {
  return [...values].sort(compareValue).map((value) => value.id);
}

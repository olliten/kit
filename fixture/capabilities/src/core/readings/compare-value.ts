import type { ScoredValue } from "../primitives/scored-value.js";
import { adjustedLimit } from "./adjusted-limit.js";

export function compareValue(left: ScoredValue, right: ScoredValue): number {
  const a = adjustedLimit(left);
  const b = adjustedLimit(right);
  if (a === null) return b === null ? left.id.localeCompare(right.id) : 1;
  if (b === null) return -1;
  return a - b || left.id.localeCompare(right.id);
}

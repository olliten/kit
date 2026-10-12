import type { ScoredValue } from "../primitives/scored-value.js";

export function adjustedLimit(value: ScoredValue): number | null {
  return value.limit === null ? null : value.limit - value.offset;
}

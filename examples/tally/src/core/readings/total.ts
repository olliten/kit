import type { Tally } from "../primitives/tally.js";

export function total(tally: Tally): number {
  return tally.amounts.reduce((sum, n) => sum + n, 0);
}

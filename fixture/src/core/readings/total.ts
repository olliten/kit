import type { Tally } from "../primitives/tally.js";
import { average } from "./average.js";

export function total(tally: Tally): number {
  return tally.amounts.reduce((sum, n) => sum + n, 0);
}

// Seeded cycle: total ↔ average. Seeded name: `summary` is not a defined term.
export function summary(tally: Tally): string {
  return `${total(tally)} (mean ${average(tally)})`;
}

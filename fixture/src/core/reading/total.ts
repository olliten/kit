import type { Tally } from "../state/tally.js";
import { average } from "./average.js";

export function total(tally: Tally): number {
  return tally.amounts.reduce((sum, n) => sum + n, 0);
}

// Seeded cycle: total ↔ average.
export function summary(tally: Tally): string {
  return `${total(tally)} (mean ${average(tally)})`;
}

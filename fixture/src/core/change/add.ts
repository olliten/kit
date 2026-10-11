import { MAX_STEP } from "../data/limits.js";
import type { Tally } from "../state/tally.js";

export function add(tally: Tally, amount: number): Tally {
  return { amounts: [...tally.amounts, Math.min(amount, MAX_STEP)] };
}

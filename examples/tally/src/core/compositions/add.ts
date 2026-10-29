import { MAX_STEP } from "../primitives/limits.js";
import type { Tally } from "../primitives/tally.js";

export function add(tally: Tally, amount: number): Tally {
  return { amounts: [...tally.amounts, Math.min(amount, MAX_STEP)] };
}

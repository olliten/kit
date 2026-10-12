import type { Tally } from "../primitives/tally.js";
import { total } from "./total.js";

export function average(tally: Tally): number {
  return tally.amounts.length === 0 ? 0 : total(tally) / tally.amounts.length;
}

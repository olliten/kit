import type { Stamp } from "../legacy/clock.js";

export function value(stamp: Stamp): number {
  return stamp.value;
}

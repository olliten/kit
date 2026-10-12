import { clock } from "../legacy/clock.js";

export function current(): number {
  return clock();
}

import type { Tally } from "../../core/primitives/tally.js";
import { label } from "../../core/readings/label.js";
import { total } from "../../core/readings/total.js";

export function screen(tally: Tally): string {
  return `Total: ${label(total(tally))}`;
}

import type { Tally } from "../../core/primitives/tally.js";
import { total } from "../../core/readings/total.js";
// Seeded: the shell imports a substrate composition instead of depending only inward.
import type { save } from "../../substrate/compositions/save.js";

export function screen(tally: Tally, _save?: typeof save): string {
  return `Total: ${total(tally)}`;
}

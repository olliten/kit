import { total } from "../../core/reading/total.js";
// Seeded: the shell imports core state, which is private to the core.
import type { Tally } from "../../core/state/tally.js";

export function screen(tally: Tally): string {
  return `Total: ${total(tally)}`;
}

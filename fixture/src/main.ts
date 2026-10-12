// Legacy: outside `<zone>/<kind>/`, so no rule holds it yet.
import { EMPTY_TALLY } from "./core/primitives/tally.js";
import { screen } from "./shell/readings/screen.js";

export const firstScreen = screen(EMPTY_TALLY);

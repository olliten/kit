// Legacy: outside `<zone>/<kind>/`, so no rule holds it yet.
import { EMPTY_TALLY } from "./core/state/tally.js";
import { screen } from "./shell/reading/screen.js";

export const firstScreen = screen(EMPTY_TALLY);

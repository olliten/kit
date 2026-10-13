import type { Clock } from "./clock.js";

export const fakeClock: Clock = {
  now: () => 7,
  sample: () => 7,
};

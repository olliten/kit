import { draw } from "../primitives/destructured-randomness.js";

export function values(): readonly number[] {
  return [1, 2].map(draw);
}

import { sample } from "../primitives/exported-randomness.js";

export function sampled(values: readonly number[]): readonly number[] {
  return values.map(sample);
}

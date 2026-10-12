import type { UnionDescription } from "../primitives/union-description.js";

export function reconstructed(description: UnionDescription): UnionDescription {
  return { ...description };
}

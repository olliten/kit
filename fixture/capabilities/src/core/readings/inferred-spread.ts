import type { WriteDescription } from "../primitives/write-description.js";

export function reconstructed(description: WriteDescription): WriteDescription {
  const inferred = { ...description, key: "other" };
  return inferred;
}

import type { WriteDescription } from "../primitives/write-description.js";

export function reconstructed(description: WriteDescription): WriteDescription {
  return { ...description, key: "other" };
}

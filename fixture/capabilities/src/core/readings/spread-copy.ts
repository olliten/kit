import type { WriteDescription } from "../primitives/write-description.js";

export function copied(description: WriteDescription): WriteDescription {
  return { ...description, value: "other" };
}

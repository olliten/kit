import type { WriteDescription } from "../primitives/write-description.js";

export function descriptionTarget(description: WriteDescription): string {
  return description.key;
}

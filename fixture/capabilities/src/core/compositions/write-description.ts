import type { WriteDescription } from "../primitives/write-description.js";

export function writeDescription(key: string, value: string): WriteDescription {
  return { kind: "put-cell", key, value };
}

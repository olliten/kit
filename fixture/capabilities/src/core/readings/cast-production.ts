import type { WriteDescription } from "../primitives/write-description.js";

export function forged(): WriteDescription {
  return { kind: "put-cell", key: "one", value: "changed" } as WriteDescription;
}

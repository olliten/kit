import type { UnionDescription } from "../primitives/union-description.js";

export function putDescription(value: string): UnionDescription {
  return { kind: "put", value };
}

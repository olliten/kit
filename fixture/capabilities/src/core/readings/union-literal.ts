import type { UnionDescription } from "../primitives/union-description.js";

export function fabricated(value: string): UnionDescription {
  return { kind: "put", value };
}

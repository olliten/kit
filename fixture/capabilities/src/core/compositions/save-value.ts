import { writeDescription } from "./write-description.js";
import type { WriteDescription } from "../primitives/write-description.js";
import { validValue } from "../readings/valid-value.js";

export type SaveResult =
  | { readonly kind: "invalid"; readonly reason: string }
  | { readonly kind: "accepted"; readonly writes: readonly WriteDescription[] };

export function saveValue(key: string, value: string, limit: number): SaveResult {
  if (!validValue(value, limit)) return { kind: "invalid", reason: "value-too-long" };
  return { kind: "accepted", writes: [writeDescription(key, value)] };
}

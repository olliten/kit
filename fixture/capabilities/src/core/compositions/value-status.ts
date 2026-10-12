import { validValue } from "../readings/valid-value.js";

export function valueStatus(value: string, limit: number): boolean {
  return validValue(value, limit);
}

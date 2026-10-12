import { cleanText } from "../primitives/cell-exports.js";

export function cleanCell(value: string): string {
  return cleanText(value);
}

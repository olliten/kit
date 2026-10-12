import { plainText } from "../../substrate/primitives/plain-text.js";

export function text(value: string): string {
  return plainText(value);
}

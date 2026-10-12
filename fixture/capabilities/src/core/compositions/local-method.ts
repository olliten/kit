import { PlainValue } from "../legacy/plain-method.js";

export function value(): number {
  return new PlainValue().value();
}

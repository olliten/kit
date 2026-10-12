import { two } from "./cycle-two.js";

export function one(): number {
  return two();
}

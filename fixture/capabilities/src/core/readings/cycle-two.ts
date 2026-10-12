import { one } from "./cycle-one.js";

export function two(): number {
  return one();
}

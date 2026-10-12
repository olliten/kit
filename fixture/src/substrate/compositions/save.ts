import type { add } from "../../core/compositions/add.js";

export function save(write: (text: string) => void, tally: ReturnType<typeof add>): void {
  write(JSON.stringify(tally));
}

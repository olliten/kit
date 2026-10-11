import type { add } from "../../core/change/add.js";

export function save(write: (text: string) => void, tally: ReturnType<typeof add>): void {
  write(JSON.stringify(tally));
}

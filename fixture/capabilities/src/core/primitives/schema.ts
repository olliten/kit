export interface Cell {
  readonly key: string;
  readonly value: string;
}
export type Choice = "keep" | "remove";
export const choices: readonly Choice[] = ["keep", "remove"];

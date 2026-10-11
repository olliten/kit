export interface Tally {
  readonly amounts: readonly number[];
}

export const EMPTY_TALLY: Tally = { amounts: [] };

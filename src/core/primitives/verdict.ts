// A check that passed, with the state of every path inside the app its run read, listed or probed, as the
// filesystem gave it after the run, and how long the run took. A test whose command wrote its coverage also
// holds the named functions of each placed module it ran, as `name@line`.
export interface Verdict {
  readonly check: string;
  readonly seconds: number;
  readonly states: Readonly<Record<string, string>>;
  readonly ran?: Readonly<Record<string, readonly string[]>>;
}

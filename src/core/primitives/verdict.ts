// A check that passed, with the state of every path inside the app its run read, listed or probed, as the
// filesystem gave it after the run, and how long the run took.
export interface Verdict {
  readonly check: string;
  readonly seconds: number;
  readonly states: Readonly<Record<string, string>>;
}

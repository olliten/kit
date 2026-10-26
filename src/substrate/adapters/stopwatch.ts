// When something happened and how long a step took: for receipts and cache bookkeeping, never a verdict.
export interface Stopwatch {
  now(): number;
  date(): number;
}

export const stopwatch: Stopwatch = { now: () => performance.now(), date: () => Date.now() };

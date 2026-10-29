// How long a step took: for receipts, never a verdict.
export interface Stopwatch {
  now(): number;
}

export const stopwatch: Stopwatch = { now: () => performance.now() };

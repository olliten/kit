// How long a step took: for receipts, never a verdict. And a pause of `ms` milliseconds between a retry's tries.
export interface Stopwatch {
  now(): number;
  pause(ms: number): void;
}

const pauses = new Int32Array(new SharedArrayBuffer(4));

export const stopwatch: Stopwatch = {
  now: () => performance.now(),
  pause: (ms) => void Atomics.wait(pauses, 0, 0, ms),
};

// The wall-clock time, as milliseconds since the epoch: it names the day a shared pass is published under, never
// whether a check passes.
export interface Calendar {
  now(): number;
}

export const calendar: Calendar = { now: () => Date.now() };

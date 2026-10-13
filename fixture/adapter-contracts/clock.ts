export interface Clock {
  now(): number;
  sample(): number;
}

export const clock: Clock = {
  now: () => Date.now(),
  sample: () => Date.now(),
};

throw new Error("The fake must not load the real clock module.");

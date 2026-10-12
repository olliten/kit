const sample: () => number = Math.random;

export function freshValue(): number {
  return sample();
}

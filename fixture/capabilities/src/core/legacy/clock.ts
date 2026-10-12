export interface Stamp {
  readonly value: number;
}

export function clock(): number {
  return Date.now();
}

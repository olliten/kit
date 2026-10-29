// What the tests ran, from the passes `kit verify` kept that still hold: for each test file, the named functions
// of each placed module it ran, as `name@line`.
export interface Runs {
  readonly tests: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

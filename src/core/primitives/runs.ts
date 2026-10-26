// What `kit runs` recorded: the digest of every placed module and test it ran over, and for each test file the
// named functions of each placed module it ran, as `name@line`.
export interface Runs {
  readonly digests: Readonly<Record<string, string>>;
  readonly tests: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

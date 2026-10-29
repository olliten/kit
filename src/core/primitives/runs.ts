// What `kit runs` recorded about one test file: the digest of every file the record depends on (the test, the
// placed files its code reaches and the placed modules it ran) and the named functions of each placed module it
// ran, as `name@line`.
export interface TestRecord {
  readonly test: string;
  readonly digests: Readonly<Record<string, string>>;
  readonly ran: Readonly<Record<string, readonly string[]>>;
}

// The fresh records together: for each test file, the named functions of each placed module it ran.
export interface Runs {
  readonly tests: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

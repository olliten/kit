// The attributable runtime context of one proof. Loaded paths are normalized source identities relative to
// the governed root; complete is false when a runtime, process or source mapping was not captured faithfully.
export interface ExecutionContext {
  readonly complete: boolean;
  readonly loaded: readonly string[];
  readonly runtime: string;
}

// What the tests ran, from passes that still hold: named functions as `name@line`, and each test's context.
// Old evidence with no context remains behavioral evidence, but grants no independent execution credit.
export interface Runs {
  readonly tests: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  readonly contexts?: Readonly<Record<string, ExecutionContext>>;
}

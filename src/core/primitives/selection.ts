// An explicit subset of complete test discovery. Discovery is the digest of sorted discovered test
// identities; policy names the caller's selection policy. Kit validates the inventory before executing it.
export interface VerificationSelection {
  readonly version: 1;
  readonly discovery: string;
  readonly policy: string;
  readonly tests: readonly string[];
}

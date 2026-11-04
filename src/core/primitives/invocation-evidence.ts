import type { Verdict } from "./verdict.js";

// Passing test evidence belonging to one verification invocation. A fresh invocation supplies this record
// directly to its post-test checks instead of borrowing execution credit from the persistent store.
export interface InvocationEvidence {
  readonly version: 1;
  readonly root: string;
  readonly runtime: string;
  readonly scripts: string;
  readonly tests: Readonly<Record<string, { readonly command: string; readonly verdict: Omit<Verdict, "seconds"> }>>;
}

import type { CompilerFacts } from "./compiler-facts.js";

export interface BrowserLaunch {
  readonly headless: boolean;
  readonly args: readonly string[];
}

export interface BrowserRuntimeIdentity {
  readonly browserVersion: string;
  readonly executableDigest: string;
}

export interface BrowserRange {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly count: number;
}

export interface BrowserFunction {
  readonly functionName: string;
  readonly ranges: readonly BrowserRange[];
}

type RecordedFunction = NonNullable<CompilerFacts["projects"][number]["functions"]>[number];

export type BrowserFunctionSite = Pick<RecordedFunction, "file" | "name" | "line"> &
  Required<Pick<RecordedFunction, "start" | "end">>;

export interface BrowserSource {
  readonly file: string;
  readonly text: string;
  readonly functions: readonly BrowserFunctionSite[];
}

export interface MappedPosition {
  readonly offset: number;
  // An original source, known external source, or an unmapped generated region.
  readonly source: string | null | undefined;
  readonly line: number;
  readonly col: number;
  readonly name: string | null;
}

export interface BrowserProofEvidence {
  readonly complete: boolean;
  readonly loaded: readonly string[];
  readonly lcov: string;
}

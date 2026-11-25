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

// One served script an app's map artifact names: the SHA-256 of its exact bytes, the app-relative base its
// map's sources resolve against, and the app-relative path of the map.
export interface BrowserMapScript {
  readonly scriptHash: string;
  readonly base: string;
  readonly map: string;
}

export interface BrowserMapArtifact {
  readonly version: 1;
  readonly scripts: readonly BrowserMapScript[];
  readonly external: readonly string[];
}

// A script a page ran, as its coverage gives it: the bytes, so the script matches its map by digest.
export interface BrowserCapturedScript {
  readonly url: string;
  readonly source: string;
  readonly functions: readonly BrowserFunction[];
}

export interface BrowserCapture {
  readonly complete: boolean;
  readonly scripts: readonly BrowserCapturedScript[];
}

// What a browser proof writes as `browser-context.json`; `browser` is diagnostic and grants nothing.
export interface BrowserContextRecord {
  readonly complete: boolean;
  readonly loaded: readonly string[];
  readonly runtime: string;
  readonly browser?: BrowserRuntimeIdentity;
}

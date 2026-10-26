// One read an extraction made, as a cache replays it: the operation, what was asked and what came back.
export interface TraceRead {
  readonly operation: string;
  readonly arguments: readonly unknown[];
  readonly result: unknown;
}

export interface TracedRead {
  readonly adapter: string;
  readonly read: TraceRead;
}

// One stored extraction: the key it answers, the root it was read at, and its trace and snapshot objects.
export interface CacheEntry {
  readonly id: string;
  readonly header: string;
  readonly root: string;
  readonly portable: boolean;
  readonly externals: readonly string[];
  readonly trace: string;
  readonly payload: string;
  readonly encoding?: "v8";
  readonly bytes: number;
  readonly created: number;
  used: number;
}

export interface CacheIndex {
  readonly version: number;
  entries: CacheEntry[];
}

// What decides whether a stored extraction can answer: the engine's own source, the runtime and the config.
export interface CacheEnvironment {
  readonly engine: string;
  readonly node: string;
  readonly typescript: string;
  readonly caseSensitive: boolean;
  readonly cwd: string;
  readonly platform: string;
  readonly maxBytes: number | undefined;
}

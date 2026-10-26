import type { KitConfig } from "../../core/primitives/default-config.js";
import type { CacheEntry, TraceRead, TracedRead } from "../../core/primitives/snapshot-cache.js";
import type { Snapshot } from "../../core/primitives/snapshot.js";
import {
  CACHE_VERSION,
  CHANGED,
  ROOT_TOKEN_JSON,
  applies,
  cacheHeader,
  digest,
  externalDirectories,
  rootPattern,
  settle,
  withRoot,
  withoutRoot,
} from "../../core/readings/snapshot-cache-key.js";
import type { CompilerRead, CompilerWorkspace } from "../adapters/compiler.js";
import type { Filesystem, FilesystemRead } from "../adapters/filesystem.js";
import { snapshotStore } from "../adapters/snapshot-store.js";
import { stopwatch } from "../adapters/stopwatch.js";

const CANDIDATES = 8;
const DEFAULT_MAX_BYTES = 2 * 1024 ** 3;

// The adapters an extraction read through, so a stored one can be asked again.
export interface Rereaders {
  readonly filesystem: Pick<Filesystem, "reread">;
  readonly compiler: Pick<CompilerWorkspace, "reread">;
}
export type SnapshotReader = (
  root: string,
  config: KitConfig,
  trace: { filesystem: FilesystemRead[]; compiler: CompilerRead[] },
) => Snapshot | Promise<Snapshot>;
export interface CacheOptions {
  readonly cacheDir?: string;
  readonly engineRoot?: string;
  readonly maxBytes?: number;
}
export interface Receipt {
  readonly key: string;
  readonly reused: boolean;
  readonly inputs: number;
  readonly seconds: number;
  readonly storageError?: string;
}

const reread = (adapters: Rereaders, { adapter, read }: TracedRead): TraceRead =>
  adapter === "filesystem" && isFilesystemRead(read)
    ? adapters.filesystem.reread(read)
    : isCompilerRead(read)
      ? adapters.compiler.reread(read)
      : read;
const isFilesystemRead = (read: TraceRead): read is FilesystemRead =>
  read.operation === "readText" || read.operation === "entries";
const isCompilerRead = (read: TraceRead): read is CompilerRead => !isFilesystemRead(read);

const unchanged = (trace: readonly TracedRead[], adapters: Rereaders): boolean =>
  trace.every((traced) => JSON.stringify(reread(adapters, traced).result) === JSON.stringify(traced.read.result));

const tracedReads = (value: unknown): TracedRead[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        const adapter: unknown = typeof item === "object" && item !== null ? Reflect.get(item, "adapter") : undefined;
        const read: unknown = typeof item === "object" && item !== null ? Reflect.get(item, "read") : undefined;
        const operation: unknown = typeof read === "object" && read !== null ? Reflect.get(read, "operation") : undefined;
        const args: unknown = typeof read === "object" && read !== null ? Reflect.get(read, "arguments") : undefined;
        return typeof adapter === "string" && typeof operation === "string" && Array.isArray(args) && typeof read === "object" && read !== null
          ? [{ adapter, read: { operation, arguments: args, result: Reflect.get(read, "result") } }]
          : [];
      })
    : [];

// An entry moves to another root only when every mention of its root came from a path, never from text it
// read, and every path outside the root is written the same way relative to both roots.
function portability(
  root: string,
  trace: readonly TracedRead[],
  payloadText: string,
): { readonly portable: boolean; readonly externals: readonly string[] } {
  const bound = { portable: false, externals: [] };
  if (snapshotStore.realpath(root) !== root) return bound;
  const pattern = rootPattern(root);
  for (const text of [JSON.stringify(trace), payloadText])
    if (text.includes(ROOT_TOKEN_JSON) || (text.match(pattern.any)?.length ?? 0) !== (text.match(pattern.path)?.length ?? 0))
      return bound;
  for (const { read } of trace) {
    if (read.operation === "getEnvironmentVariable" && String(read.result).includes(root)) return bound;
    const [path] = read.arguments;
    if ((read.operation === "readText" || read.operation === "readFile") && typeof read.result === "string")
      try {
        if (typeof path !== "string" || snapshotStore.mentions(path, root)) return bound;
      } catch {
        return bound;
      }
  }
  return { portable: true, externals: externalDirectories(root, trace) };
}

function removeUnreferenced(store: string, dropped: readonly CacheEntry[], entries: readonly CacheEntry[]): void {
  const live = new Set(entries.flatMap((entry) => [entry.trace, entry.payload]));
  for (const entry of dropped)
    for (const id of [entry.trace, entry.payload]) if (!live.has(id)) snapshotStore.remove(store, id);
}

function forget(store: string, entry: CacheEntry): void {
  const index = snapshotStore.update(store, CACHE_VERSION, (current) => {
    current.entries = current.entries.filter((item) => item.id !== entry.id);
  });
  if (index !== undefined) removeUnreferenced(store, [entry], index.entries);
}

function lookup(
  store: string,
  header: string,
  root: string,
  adapters: Rereaders,
): { readonly snapshot: Snapshot; readonly trace: TracedRead[] } | undefined {
  const candidates = snapshotStore
    .index(store, CACHE_VERSION)
    .entries.filter((entry) => applies(entry, header, root))
    .sort((a, b) => b.created - a.created)
    .slice(0, CANDIDATES);
  for (const entry of candidates) {
    let trace: TracedRead[];
    let snapshot: unknown;
    try {
      trace = tracedReads(JSON.parse(withRoot(snapshotStore.text(store, entry.trace), root)));
      if (!unchanged(trace, adapters)) continue;
      snapshot =
        entry.encoding === "v8"
          ? snapshotStore.value(store, entry.payload)
          : JSON.parse(withRoot(snapshotStore.text(store, entry.payload), root));
    } catch {
      forget(store, entry);
      continue;
    }
    if (!isSnapshot(snapshot)) {
      forget(store, entry);
      continue;
    }
    snapshotStore.update(store, CACHE_VERSION, (index) => {
      for (const item of index.entries) if (item.id === entry.id) item.used = stopwatch.date();
    });
    return { snapshot, trace };
  }
  return undefined;
}

const isSnapshot = (value: unknown): value is Snapshot =>
  typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "files"));

function remember(
  store: string,
  header: string,
  root: string,
  trace: readonly TracedRead[],
  snapshot: Snapshot,
  maxBytes: number,
): void {
  let payload: string | Uint8Array;
  let encoding: "v8" | undefined;
  let portable = false;
  let externals: readonly string[] = [];
  try {
    const text = JSON.stringify(snapshot);
    ({ portable, externals } = portability(root, trace, text));
    payload = portable ? withoutRoot(text, root) : text;
  } catch {
    // Its paths stay bound to this root; only the JSON format supports relocation.
    payload = snapshotStore.encoded(snapshot);
    encoding = "v8";
  }
  const traceText = JSON.stringify(trace);
  const traceObject = snapshotStore.put(store, portable ? withoutRoot(traceText, root) : traceText);
  const payloadObject = snapshotStore.put(store, payload);
  const now = stopwatch.date();
  const entry: CacheEntry = {
    id: digest(JSON.stringify([header, traceObject.id, payloadObject.id, portable ? null : root])),
    header,
    root,
    portable,
    externals,
    trace: traceObject.id,
    payload: payloadObject.id,
    ...(encoding === undefined ? {} : { encoding }),
    bytes: traceObject.bytes + payloadObject.bytes,
    created: now,
    used: now,
  };
  const dropped: CacheEntry[] = [];
  const index = snapshotStore.update(store, CACHE_VERSION, (current) => {
    current.entries = [...current.entries.filter((item) => item.id !== entry.id), entry];
    let total = current.entries.reduce((sum, item) => sum + item.bytes, 0);
    // Least recently used first, never the entry just written.
    const order = current.entries.filter((item) => item.id !== entry.id).sort((a, b) => a.used - b.used);
    for (let victim = order.shift(); total > maxBytes && victim !== undefined; victim = order.shift()) {
      total -= victim.bytes;
      dropped.push(victim);
    }
    current.entries = current.entries.filter((item) => !dropped.includes(item));
  });
  if (index !== undefined) removeUnreferenced(store, dropped, index.entries);
}

// Reuse extraction, never a verdict. The caller runs the checker and invokes validate() before accepting its
// result. A snapshot is reused while every read its extraction made still returns the same, so an input
// extraction never read cannot change it. A corrupt entry is dropped and extraction runs again.
export async function cachedSnapshot(
  root: string,
  config: KitConfig,
  readSnapshot: SnapshotReader,
  adapters: Rereaders,
  options: CacheOptions = {},
): Promise<{ readonly snapshot: Snapshot; readonly validate: () => void; readonly receipt: Receipt }> {
  const started = stopwatch.now();
  const store = options.cacheDir ?? snapshotStore.directory(root);
  const environment = snapshotStore.environment(options.engineRoot ?? new URL("../../..", import.meta.url).pathname);
  const header = cacheHeader(root, config, environment);
  const maxBytes = options.maxBytes ?? environment.maxBytes ?? DEFAULT_MAX_BYTES;
  let found;
  try {
    found = lookup(store, header, root, adapters);
  } catch {
    found = undefined;
  }
  let snapshot: Snapshot;
  let trace: TracedRead[];
  let storageError: string | undefined;
  if (found !== undefined) ({ snapshot, trace } = found);
  else {
    const recorded: { filesystem: FilesystemRead[]; compiler: CompilerRead[] } = { filesystem: [], compiler: [] };
    snapshot = await readSnapshot(root, config, recorded);
    trace = settle(recorded);
  }
  const validate = (): void => {
    if (!unchanged(trace, adapters)) throw new Error(CHANGED);
  };
  if (found === undefined) {
    validate();
    try {
      remember(store, header, root, trace, snapshot, maxBytes);
    } catch (error) {
      // The cache is disposable; extraction remains the authority.
      storageError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    snapshot,
    validate,
    receipt: {
      key: header,
      reused: found !== undefined,
      inputs: trace.length,
      seconds: (stopwatch.now() - started) / 1000,
      ...(storageError === undefined ? {} : { storageError }),
    },
  };
}

// The gate rechecks even a reused snapshot. Limits and debt stay in the checker's result; neither this cache
// nor its receipt supplies an architectural verdict.
export async function cachedKitCheck<T>(
  root: string,
  config: KitConfig,
  readSnapshot: SnapshotReader,
  checkSnapshot: (snapshot: Snapshot) => T | Promise<T>,
  adapters: Rereaders,
  options: CacheOptions = {},
): Promise<{ readonly result: T; readonly snapshot: Snapshot; readonly receipt: Receipt & { readonly checkSeconds: number } }> {
  const cached = await cachedSnapshot(root, config, readSnapshot, adapters, options);
  const started = stopwatch.now();
  const result = await checkSnapshot(cached.snapshot);
  cached.validate();
  return {
    result,
    snapshot: cached.snapshot,
    receipt: { ...cached.receipt, checkSeconds: (stopwatch.now() - started) / 1000 },
  };
}

import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deserialize, serialize } from "node:v8";
import ts from "typescript";

const VERSION = 3;
const CANDIDATES = 8;
const DEFAULT_MAX_BYTES = 2 * 1024 ** 3;
const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Stands for the app root inside stored traces and payloads, so worktrees of one repository share entries.
const ROOT_TOKEN_JSON = JSON.stringify("\u0000kit-root\u0000").slice(1, -1);
const CHANGED = "Kit inputs changed during checking; rerun gate:changed.";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Worktrees of one repository share the cache through the common Git directory; outside Git it is per root. */
export function cacheDirectory(root, env = process.env) {
  for (let directory = resolve(root); ; directory = dirname(directory)) {
    const dotGit = join(directory, ".git");
    let stat;
    try {
      stat = statSync(dotGit);
    } catch {
      stat = undefined;
    }
    if (stat?.isDirectory()) return join(commonGitDirectory(dotGit), "kit-cache");
    if (stat?.isFile()) {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"));
      if (pointer?.[1]) return join(commonGitDirectory(resolve(directory, pointer[1])), "kit-cache");
    }
    if (dirname(directory) === directory) break;
  }
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "kit", digest(realpathSync(root)));
}

function commonGitDirectory(gitDirectory) {
  try {
    return resolve(gitDirectory, readFileSync(join(gitDirectory, "commondir"), "utf8").trim());
  } catch {
    return gitDirectory;
  }
}

const engineHashes = new Map();
/** The Kit's own source decides what extraction does, so a change to it is a different cache. */
function engineHash(engineRoot) {
  const known = engineHashes.get(engineRoot);
  if (known !== undefined) return known;
  const hash = createHash("sha256");
  const visit = (path) => {
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort(byName)) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile())
        hash.update(JSON.stringify([relative(engineRoot, child)])).update(readFileSync(child));
    }
  };
  visit(join(engineRoot, "src"));
  visit(join(engineRoot, "scripts"));
  for (const file of ["package.json", "package-lock.json"])
    try {
      hash.update(JSON.stringify([file])).update(readFileSync(join(engineRoot, file)));
    } catch {
      hash.update(JSON.stringify([file, null]));
    }
  const value = hash.digest("hex");
  engineHashes.set(engineRoot, value);
  return value;
}

function headerOf(root, config, engineRoot) {
  const cwd = process.cwd();
  return digest(
    JSON.stringify({
      version: VERSION,
      engine: engineHash(engineRoot),
      node: process.version,
      typescript: ts.version,
      caseSensitive: ts.sys.useCaseSensitiveFileNames,
      cwd: cwd === root || cwd.startsWith(`${root}/`) ? relative(root, cwd) : cwd,
      platform: process.platform,
      config,
    }),
  );
}

/** The root as JSON text: every mention, and the mentions that are a path ending at or continuing below it. */
function rootPattern(root) {
  const escaped = JSON.stringify(root)
    .slice(1, -1)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { any: new RegExp(escaped, "g"), path: new RegExp(`${escaped}(?=[/'\\s:),]|\\\\"|")`, "g") };
}
const withoutRoot = (text, root) => text.replace(rootPattern(root).path, () => ROOT_TOKEN_JSON);
const withRoot = (text, root) => text.replaceAll(ROOT_TOKEN_JSON, () => JSON.stringify(root).slice(1, -1));

// Cheap reads first and file contents last, so a stale candidate is usually rejected before a file is hashed.
const COST = {
  getEnvironmentVariable: 0,
  fileExists: 1,
  directoryExists: 1,
  realpath: 1,
  getDirectories: 2,
  entries: 2,
  readDirectory: 3,
  readText: 4,
  readFile: 4,
};

/** One read per question; the same question answered two ways means the tree moved during extraction. */
function settle(recorded) {
  const reads = new Map();
  for (const [adapter, list] of Object.entries(recorded))
    for (const read of list) {
      const key = JSON.stringify([adapter, read.operation, read.arguments]);
      const known = reads.get(key);
      if (known === undefined) reads.set(key, { adapter, read });
      else if (JSON.stringify(known.read.result) !== JSON.stringify(read.result)) throw new Error(CHANGED);
    }
  return [...reads.values()].sort((a, b) => COST[a.read.operation] - COST[b.read.operation]);
}

function unchanged(trace, adapters) {
  for (const { adapter, read } of trace)
    if (JSON.stringify(adapters[adapter].reread(read).result) !== JSON.stringify(read.result)) return false;
  return true;
}

/** An entry moves to another root only when every mention of its root came from a path, never from text it
 * read, and every path outside the root is written the same way relative to both roots. */
function portability(root, trace, payloadText) {
  const bound = { portable: false, externals: [] };
  if (realpathSync(root) !== root) return bound;
  const pattern = rootPattern(root);
  for (const text of [JSON.stringify(trace), payloadText])
    if (
      text.includes(ROOT_TOKEN_JSON) ||
      (text.match(pattern.any)?.length ?? 0) !== (text.match(pattern.path)?.length ?? 0)
    )
      return bound;
  const needle = Buffer.from(root);
  for (const { read } of trace) {
    if (read.operation === "getEnvironmentVariable" && String(read.result).includes(root)) return bound;
    if ((read.operation === "readText" || read.operation === "readFile") && typeof read.result === "string")
      try {
        if (readFileSync(read.arguments[0]).includes(needle)) return bound;
      } catch {
        return bound;
      }
  }
  const externals = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (
      typeof value === "string" &&
      isAbsolute(value) &&
      value !== root &&
      !value.startsWith(`${root}/`)
    )
      externals.add(dirname(value));
  };
  for (const { read } of trace) {
    visit(read.arguments);
    visit(read.result);
  }
  return { portable: true, externals: [...externals].sort() };
}

function applies(entry, header, root) {
  if (entry.header !== header) return false;
  if (!entry.portable) return entry.root === root;
  return entry.externals.every((path) => relative(entry.root, path) === relative(root, path));
}

function readIndex(store) {
  try {
    const index = JSON.parse(readFileSync(join(store, "index.json"), "utf8"));
    if (index.version === VERSION && Array.isArray(index.entries)) return index;
  } catch {
    // A missing or unreadable index is an empty cache.
  }
  return { version: VERSION, entries: [] };
}

function writeAtomically(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const objectPath = (store, id) => join(store, "objects", `${id}.json`);

function putObject(store, text) {
  const id = digest(text);
  try {
    statSync(objectPath(store, id));
  } catch {
    writeAtomically(objectPath(store, id), text);
  }
  return { id, bytes: Buffer.byteLength(text) };
}

function getObject(store, id, encoding = "utf8") {
  const text = readFileSync(objectPath(store, id), encoding);
  if (digest(text) !== id) throw new Error("Kit cache object is corrupt");
  return text;
}

const pause = new Int32Array(new SharedArrayBuffer(4));
/** Index updates read, modify and write, so writers take turns; a lock older than a minute is abandoned.
 * Returns the updated index, or undefined when the lock stayed busy and nothing was written. */
function withIndex(store, update) {
  mkdirSync(store, { recursive: true });
  const lock = join(store, "index.lock");
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 60_000) rmSync(lock, { force: true });
      } catch {
        // The holder released it meanwhile.
      }
      if (Date.now() > deadline) return undefined;
      Atomics.wait(pause, 0, 0, 25);
    }
  }
  try {
    const index = readIndex(store);
    update(index);
    writeAtomically(join(store, "index.json"), JSON.stringify(index));
    return index;
  } finally {
    rmSync(lock, { force: true });
  }
}

function removeUnreferenced(store, dropped, index) {
  const live = new Set(index.entries.flatMap((entry) => [entry.trace, entry.payload]));
  for (const entry of dropped)
    for (const id of [entry.trace, entry.payload])
      if (!live.has(id)) rmSync(objectPath(store, id), { force: true });
}

function forget(store, entry) {
  const index = withIndex(store, (current) => {
    current.entries = current.entries.filter((item) => item.id !== entry.id);
  });
  if (index !== undefined) removeUnreferenced(store, [entry], index);
}

function lookup(store, header, root, adapters) {
  const candidates = readIndex(store)
    .entries.filter((entry) => applies(entry, header, root))
    .sort((a, b) => b.created - a.created)
    .slice(0, CANDIDATES);
  for (const entry of candidates) {
    let trace;
    let snapshot;
    try {
      trace = JSON.parse(withRoot(getObject(store, entry.trace), root));
      if (!unchanged(trace, adapters)) continue;
      snapshot = entry.encoding === "v8"
        ? deserialize(getObject(store, entry.payload, null))
        : JSON.parse(withRoot(getObject(store, entry.payload), root));
    } catch {
      forget(store, entry);
      continue;
    }
    withIndex(store, (index) => {
      for (const item of index.entries) if (item.id === entry.id) item.used = Date.now();
    });
    return { snapshot, trace };
  }
  return undefined;
}

function remember(store, header, root, trace, snapshot, maxBytes) {
  let payload;
  let encoding;
  let portable = false;
  let externals = [];
  try {
    payload = JSON.stringify(snapshot);
    ({ portable, externals } = portability(root, trace, payload));
  } catch {
    // Binary encoding preserves shared graphs without expanding them into one enormous string.
    // Its paths stay bound to this root; only the JSON format supports relocation.
    payload = serialize(snapshot);
    encoding = "v8";
  }
  const stored = (text) => (portable ? withoutRoot(text, root) : text);
  const traceObject = putObject(store, stored(JSON.stringify(trace)));
  const payloadObject = putObject(store, encoding === "v8" ? payload : stored(payload));
  const now = Date.now();
  const entry = {
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
  const dropped = [];
  const index = withIndex(store, (current) => {
    current.entries = [...current.entries.filter((item) => item.id !== entry.id), entry];
    let total = current.entries.reduce((sum, item) => sum + item.bytes, 0);
    // Least recently used first, never the entry just written.
    const order = current.entries.filter((item) => item.id !== entry.id).sort((a, b) => a.used - b.used);
    while (total > maxBytes && order.length > 0) {
      const victim = order.shift();
      total -= victim.bytes;
      dropped.push(victim);
    }
    current.entries = current.entries.filter((item) => !dropped.includes(item));
  });
  if (index !== undefined) removeUnreferenced(store, dropped, index);
}

/** Reuse extraction, never a verdict. The caller runs the checker and invokes validate() before accepting
 * its result. A snapshot is reused while every read its extraction made still returns the same, so an
 * input extraction never read cannot change it. A corrupt entry is dropped and extraction runs again. */
export async function cachedSnapshot(root, config, readSnapshot, adapters, options = {}) {
  const started = performance.now();
  const store = options.cacheDir ?? cacheDirectory(root);
  const header = headerOf(root, config, options.engineRoot ?? ENGINE);
  const maxBytes = options.maxBytes ?? (Number(process.env.KIT_CACHE_MAX_BYTES) || DEFAULT_MAX_BYTES);
  let found;
  try {
    found = lookup(store, header, root, adapters);
  } catch {
    found = undefined;
  }
  let snapshot;
  let trace;
  let storageError;
  if (found !== undefined) ({ snapshot, trace } = found);
  else {
    const recorded = { filesystem: [], compiler: [] };
    snapshot = await readSnapshot(root, config, recorded);
    trace = settle(recorded);
  }
  const validate = () => {
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
      seconds: (performance.now() - started) / 1000,
      ...(storageError === undefined ? {} : { storageError }),
    },
  };
}

/** The gate rechecks even a reused snapshot. Limits and debt stay in the checker's result;
 * neither this cache nor its receipt supplies an architectural verdict. */
export async function cachedKitCheck(root, config, readSnapshot, checkSnapshot, adapters, options = {}) {
  const cached = await cachedSnapshot(root, config, readSnapshot, adapters, options);
  const started = performance.now();
  const result = await checkSnapshot(cached.snapshot);
  cached.validate();
  return {
    result,
    snapshot: cached.snapshot,
    receipt: { ...cached.receipt, checkSeconds: (performance.now() - started) / 1000 },
  };
}

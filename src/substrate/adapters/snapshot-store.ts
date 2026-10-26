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
import { dirname, join, relative, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";
import ts from "typescript";
import type { CacheEnvironment, CacheIndex } from "../../core/primitives/snapshot-cache.js";

// Where stored extractions live and how they are written: objects named by their digest, and an index that
// writers take turns to update.
export interface SnapshotStore {
  directory(root: string): string;
  environment(engineRoot: string): CacheEnvironment;
  index(store: string, version: number): CacheIndex;
  // Applies `update` to the index under its lock; undefined when the lock stayed busy and nothing was written.
  update(store: string, version: number, update: (index: CacheIndex) => void): CacheIndex | undefined;
  put(store: string, content: string | Uint8Array): { readonly id: string; readonly bytes: number };
  text(store: string, id: string): string;
  value(store: string, id: string): unknown;
  encoded(value: unknown): Uint8Array;
  remove(store: string, id: string): void;
  realpath(path: string): string;
  mentions(path: string, text: string): boolean;
}

const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const objectPath = (store: string, id: string): string => join(store, "objects", `${id}.json`);
const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

function commonGitDirectory(gitDirectory: string): string {
  try {
    return resolve(gitDirectory, readFileSync(join(gitDirectory, "commondir"), "utf8").trim());
  } catch {
    return gitDirectory;
  }
}

const engineHashes = new Map<string, string>();
// The Kit's own source decides what extraction does, so a change to it is a different cache.
function engineHash(engineRoot: string): string {
  const known = engineHashes.get(engineRoot);
  if (known !== undefined) return known;
  const hash = createHash("sha256");
  const visit = (path: string): void => {
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort(byName)) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) hash.update(JSON.stringify([relative(engineRoot, child)])).update(readFileSync(child));
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

function readIndex(store: string, version: number): CacheIndex {
  try {
    const index: unknown = JSON.parse(readFileSync(join(store, "index.json"), "utf8"));
    if (
      typeof index === "object" &&
      index !== null &&
      Reflect.get(index, "version") === version &&
      Array.isArray(Reflect.get(index, "entries"))
    )
      return { version, entries: Reflect.get(index, "entries") };
  } catch {
    // A missing or unreadable index is an empty cache.
  }
  return { version, entries: [] };
}

function writeAtomically(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function read(store: string, id: string): Buffer {
  const bytes = readFileSync(objectPath(store, id));
  if (digest(bytes) !== id) throw new Error("Kit cache object is corrupt");
  return bytes;
}

const pause = new Int32Array(new SharedArrayBuffer(4));

export const snapshotStore: SnapshotStore = {
  // Worktrees of one repository share the cache through the common Git directory; outside Git it is per root.
  directory(root) {
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
    return join(process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache"), "kit", digest(realpathSync(root)));
  },
  environment(engineRoot) {
    const limit = Number(process.env["KIT_CACHE_MAX_BYTES"]);
    return {
      engine: engineHash(engineRoot),
      node: process.version,
      typescript: ts.version,
      caseSensitive: ts.sys.useCaseSensitiveFileNames,
      cwd: process.cwd(),
      platform: process.platform,
      maxBytes: limit > 0 ? limit : undefined,
    };
  },
  index: readIndex,
  // Index updates read, modify and write, so writers take turns; a lock older than a minute is abandoned.
  update(store, version, update) {
    mkdirSync(store, { recursive: true });
    const lock = join(store, "index.lock");
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        closeSync(openSync(lock, "wx"));
        break;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
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
      const index = readIndex(store, version);
      update(index);
      writeAtomically(join(store, "index.json"), JSON.stringify(index));
      return index;
    } finally {
      rmSync(lock, { force: true });
    }
  },
  put(store, content) {
    const id = digest(content);
    try {
      statSync(objectPath(store, id));
    } catch {
      writeAtomically(objectPath(store, id), content);
    }
    return { id, bytes: typeof content === "string" ? Buffer.byteLength(content) : content.byteLength };
  },
  text: (store, id) => read(store, id).toString("utf8"),
  value: (store, id) => deserialize(read(store, id)),
  // Binary encoding preserves shared graphs without expanding them into one enormous string.
  encoded: (value) => serialize(value),
  remove(store, id) {
    rmSync(objectPath(store, id), { force: true });
  },
  realpath: (path) => realpathSync(path),
  mentions(path, text) {
    return readFileSync(path).includes(Buffer.from(text));
  },
};

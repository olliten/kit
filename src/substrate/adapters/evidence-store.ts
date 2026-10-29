import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";

// Where what a machine learns about an app is kept between runs: one file per key, so writers never contend
// for an index, and the least recently used are evicted past a limit.
export interface EvidenceStore {
  directory(root: string): string;
  read(store: string, kind: string, key: string): string | undefined;
  write(store: string, kind: string, key: string, text: string): void;
  prune(store: string): void;
}

const DEFAULT_MAX_BYTES = 2 * 1024 ** 3;
const pathOf = (store: string, kind: string, key: string): string => join(store, kind, key.slice(0, 2), `${key}.json`);

function commonGitDirectory(gitDirectory: string): string {
  try {
    return resolve(gitDirectory, readFileSync(join(gitDirectory, "commondir"), "utf8").trim());
  } catch {
    return gitDirectory;
  }
}

function files(directory: string): { readonly path: string; readonly bytes: number; readonly used: number }[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    if (!entry.isFile()) return [];
    const stat = statSync(path);
    return [{ path, bytes: stat.size, used: stat.mtimeMs }];
  });
}

export const evidenceStore: EvidenceStore = {
  // Worktrees of one repository share the store through the common Git directory; outside Git it is per root.
  directory(root) {
    for (let directory = resolve(root); ; directory = dirname(directory)) {
      const dotGit = join(directory, ".git");
      let stat;
      try {
        stat = statSync(dotGit);
      } catch {
        stat = undefined;
      }
      if (stat?.isDirectory()) return join(commonGitDirectory(dotGit), "kit-store");
      if (stat?.isFile()) {
        const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"));
        if (pointer?.[1]) return join(commonGitDirectory(resolve(directory, pointer[1])), "kit-store");
      }
      if (dirname(directory) === directory) break;
    }
    const name = createHash("sha256").update(resolve(root)).digest("hex");
    return join(process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache"), "kit", name);
  },
  // A read marks the entry used, so eviction keeps what runs keep asking for.
  read(store, kind, key) {
    const path = pathOf(store, kind, key);
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
    const now = new Date();
    try {
      utimesSync(path, now, now);
    } catch {
      // An entry another run evicted meanwhile was still read whole.
    }
    return text;
  },
  // Written beside its place and renamed into it, so a reader never sees half an entry; a key names its content,
  // so two writers of one key write the same thing.
  write(store, kind, key, text) {
    const path = pathOf(store, kind, key);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, text);
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  },
  prune(store) {
    const limit = Number(process.env["KIT_STORE_MAX_BYTES"]) || DEFAULT_MAX_BYTES;
    const entries = files(store).sort((a, b) => a.used - b.used);
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of entries) {
      if (total <= limit) break;
      rmSync(entry.path, { force: true });
      total -= entry.bytes;
    }
  },
};

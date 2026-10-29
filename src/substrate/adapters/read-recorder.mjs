import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { threadId } from "node:worker_threads";

// Preloaded into a check's processes, it records every path inside the app the check reads, lists or probes,
// in its own process, its worker threads and the processes it starts, which inherit the preload. Only when the
// recording is asked for does it touch the file system's operations, so loading it to find its path changes
// nothing.
export const readRecorder = {
  location: fileURLToPath(import.meta.url),
};

const directory = process.env["KIT_READS"];
const root = process.env["KIT_ROOT"];
if (directory && root) {
  const out = `${directory}/${process.pid}-${threadId}.txt`;
  const prefix = `${root}/`;
  const append = fs.appendFileSync;
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {unknown} path */
  const note = (path) => {
    const given =
      typeof path === "string"
        ? path
        : path instanceof URL
          ? fileURLToPath(path)
          : path instanceof Uint8Array
            ? new TextDecoder().decode(path)
            : undefined;
    if (given === undefined) return;
    // A relative path is read from the process's working directory, which a check may change as it runs.
    const text = isAbsolute(given) ? resolve(given) : resolve(process.cwd(), given);
    if (!text.startsWith(prefix) || seen.has(text)) return;
    seen.add(text);
    const local = text.slice(prefix.length);
    // Installed packages are the lockfile's, and the repository's own bookkeeping is no input.
    if (local.startsWith("node_modules/") || local.includes("/node_modules/") || local.startsWith(".git/")) return;
    // Written whole as each path is first seen, since a worker thread can end without a chance to flush.
    append(out, `${local}\n`);
  };
  /**
   * @param {object} target
   * @param {readonly string[]} names
   */
  const wrap = (target, names) => {
    for (const name of names) {
      const original = Reflect.get(target, name);
      if (typeof original !== "function") continue;
      /** @this {unknown} @param {unknown} path @param {unknown[]} rest */
      const wrapped = function (path, ...rest) {
        note(path);
        return Reflect.apply(original, this, [path, ...rest]);
      };
      // A wrapped operation keeps the original's name and own properties, such as `realpathSync.native`.
      Object.defineProperty(wrapped, "name", { value: original.name });
      Reflect.set(target, name, Object.assign(wrapped, original));
    }
  };
  wrap(fs, [
    "readFileSync", "readdirSync", "statSync", "lstatSync", "existsSync", "accessSync", "openSync", "realpathSync",
    "readFile", "readdir", "stat", "lstat", "access", "open", "createReadStream",
  ]);
  wrap(fs.promises, ["readFile", "readdir", "stat", "lstat", "access", "open"]);
  syncBuiltinESMExports();
}

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { threadId } from "node:worker_threads";

// Preloaded into a check's processes, it records every path inside the app the check reads, lists or probes,
// in its own process, its worker threads and the processes it starts, which inherit the preload, each with how it
// was used: read, listed, only probed, or loaded, which is read by the module loader alone (Node's own, or the
// test runner's). Only when the recording is asked for does it touch the file system's operations, so loading it
// to find its path changes nothing.
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
  // The frame that asked: the first outside this recorder and Node's own modules, or none when Node itself did.
  const caller = () =>
    (new Error().stack ?? "")
      .split("\n")
      .slice(1)
      .find((frame) => !frame.includes("read-recorder.mjs") && !/[( ]node:/.test(frame));
  const LOADERS = /\/node_modules\/(?:vite|vite-node|vitest|@vitest\/[^/]+)\//;
  const PROBES = new Set(["statSync", "lstatSync", "existsSync", "accessSync", "realpathSync", "stat", "lstat", "access"]);
  const LISTINGS = new Set(["readdirSync", "opendirSync", "opendir", "readdir"]);
  /** @param {unknown} path @param {string} operation */
  const note = (path, operation) => {
    const frame = PROBES.has(operation) ? undefined : caller();
    // A listing an installed package makes, such as a test runner finding its test files, is the runner's and
    // not the check's: recording it would make adding any file under a listed directory rerun every check.
    if (LISTINGS.has(operation) && frame?.includes("/node_modules/")) return;
    const kind = PROBES.has(operation)
      ? "probe"
      : LISTINGS.has(operation)
        ? "list"
        : frame === undefined || LOADERS.test(frame)
          ? "load"
          : "read";
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
    if (!text.startsWith(prefix) || seen.has(`${kind} ${text}`)) return;
    seen.add(`${kind} ${text}`);
    const local = text.slice(prefix.length);
    // Installed packages are the lockfile's, and the repository's own bookkeeping is no input.
    if (local.startsWith("node_modules/") || local.includes("/node_modules/") || local.startsWith(".git/")) return;
    // Written whole as each path is first seen, since a worker thread can end without a chance to flush.
    append(out, `${kind} ${local}\n`);
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
        note(path, name);
        return Reflect.apply(original, this, [path, ...rest]);
      };
      // A wrapped operation keeps the original's name and own properties, such as `realpathSync.native`.
      Object.defineProperty(wrapped, "name", { value: original.name });
      Reflect.set(target, name, Object.assign(wrapped, original));
    }
  };
  wrap(fs, [
    "readFileSync", "readdirSync", "opendirSync", "opendir", "statSync", "lstatSync", "existsSync", "accessSync", "openSync", "realpathSync",
    "readFile", "readdir", "stat", "lstat", "access", "open", "createReadStream",
  ]);
  wrap(fs.promises, ["readFile", "readdir", "stat", "lstat", "access", "open"]);
  syncBuiltinESMExports();
}

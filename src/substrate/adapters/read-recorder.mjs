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
  // One file per process and thread, named by both, so what each process loaded can be told apart.
  const out = `${directory}/${process.pid}-${threadId}.txt`;
  const prefix = `${root}/`;
  const append = fs.appendFileSync;
  // The recorder's own walks use the operations as they were, so they are not recorded twice.
  const listing = fs.readdirSync;
  const statOf = fs.statSync;
  /** @type {Set<string>} */
  const seen = new Set();
  // The file of the frame that asked: the first outside this recorder, Node's own modules and built-in functions,
  // or none when Node itself did. The stack is taken deep enough whatever limit the check set.
  const caller = () => {
    const { stackTraceLimit, prepareStackTrace } = Error;
    Error.stackTraceLimit = 64;
    Error.prepareStackTrace = (_, sites) => sites;
    /** @type {{ stack?: unknown }} */
    const holder = {};
    Error.captureStackTrace(holder);
    const sites = holder.stack;
    Error.stackTraceLimit = stackTraceLimit;
    Error.prepareStackTrace = prepareStackTrace;
    if (!Array.isArray(sites)) return undefined;
    for (const site of sites) {
      const file = typeof site?.getFileName === "function" ? site.getFileName() : undefined;
      if (typeof file === "string" && file !== "" && !file.startsWith("node:") && !file.includes("read-recorder.mjs")) return file;
    }
    return undefined;
  };
  const LOADERS = /\/node_modules\/(?:vite|vite-node|vitest|@vitest\/[^/]+)\//;
  const PROBES = new Set(["statSync", "lstatSync", "existsSync", "accessSync", "realpathSync", "native", "statfsSync", "stat", "lstat", "access", "realpath", "statfs"]);
  const LISTINGS = new Set(["readdirSync", "opendirSync", "opendir", "readdir"]);
  const COPIES = new Set(["copyFileSync", "copyFile", "cpSync", "cp"]);
  const GLOBS = new Set(["globSync", "glob"]);
  /** @param {string} operation @returns {string | undefined} */
  const useOf = (operation) => {
    if (PROBES.has(operation)) return "probe";
    const frame = caller();
    // The test runner's own listings, such as finding its test files, are not the check's: recording them would
    // make adding any file under a listed directory rerun every test. Any other package's listing, such as a
    // compiler expanding its configuration's globs, is the check's.
    if (frame !== undefined && LOADERS.test(frame)) return LISTINGS.has(operation) || GLOBS.has(operation) ? undefined : "load";
    if (LISTINGS.has(operation) || GLOBS.has(operation)) return "list";
    return frame === undefined ? "load" : "read";
  };
  /** @param {unknown} path @returns {string | undefined} */
  const absolute = (path) => {
    const given =
      typeof path === "string"
        ? path
        : path instanceof URL
          ? fileURLToPath(path)
          : path instanceof Uint8Array
            ? new TextDecoder().decode(path)
            : undefined;
    if (given === undefined) return undefined;
    // A relative path is read from the process's working directory, which a check may change as it runs.
    const text = isAbsolute(given) ? resolve(given) : resolve(process.cwd(), given);
    return text === root || text.startsWith(prefix) ? text : undefined;
  };
  /** @param {string} use @param {string} text */
  const record = (use, text) => {
    // The app root itself is `.`.
    const local = text === root ? "." : text.slice(prefix.length);
    // Installed packages are the lockfile's, and the repository's own bookkeeping is no input.
    const parts = local.split("/");
    if (parts.includes("node_modules") || parts[0] === ".git" || seen.has(`${use} ${local}`)) return;
    seen.add(`${use} ${local}`);
    // Written whole as each path is first seen, since a worker thread can end without a chance to flush.
    append(out, `${use} ${local}\n`);
  };
  // Every directory under one, as listed, and with `files` every file in it as used, for an operation that
  // reaches into the whole tree: a recursive listing, a glob, or a copy of a directory.
  /** @param {string} at @param {string | undefined} files */
  const walk = (at, files) => {
    let entries;
    try {
      entries = listing(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const child = `${at}/${entry.name}`;
      if (entry.isDirectory()) {
        record("list", child);
        walk(child, files);
      } else if (files !== undefined) record(files, child);
    }
  };
  /** @param {string} at */
  const isDirectory = (at) => {
    try {
      return statOf(at).isDirectory();
    } catch {
      return false;
    }
  };
  // A glob's patterns list the directory each starts from, and everything under it; a pattern without one
  // names a single path, which is only probed.
  /** @param {unknown} patterns @param {unknown} options */
  const noteGlob = (patterns, options) => {
    const cwd = typeof options === "object" && options !== null ? Reflect.get(options, "cwd") : undefined;
    const base = typeof cwd === "string" ? resolve(process.cwd(), cwd) : process.cwd();
    for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
      if (typeof pattern !== "string") continue;
      const segments = pattern.split("/");
      const magic = segments.findIndex((segment) => /[*?[\]{}!]/.test(segment));
      const fixed = absolute(resolve(base, ...(magic < 0 ? segments : segments.slice(0, magic))));
      if (fixed === undefined) continue;
      if (magic < 0) record("probe", fixed);
      else {
        record("list", fixed);
        walk(fixed, undefined);
      }
    }
  };
  /** @param {unknown} path @param {string} operation @param {unknown[]} rest */
  const note = (path, operation, rest) => {
    if (GLOBS.has(operation)) {
      if (useOf(operation) !== undefined) noteGlob(path, rest[0]);
      return;
    }
    const text = absolute(path);
    if (text === undefined) return;
    const use = useOf(operation);
    if (use === undefined) return;
    // Copying a directory lists it and reads every file under it.
    if (COPIES.has(operation) && isDirectory(text)) {
      record("list", text);
      walk(text, use);
      return;
    }
    record(use, text);
    const options = rest[0];
    if (LISTINGS.has(operation) && typeof options === "object" && options !== null && Reflect.get(options, "recursive") === true) walk(text, undefined);
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
        note(path, name, rest);
        return Reflect.apply(original, this, [path, ...rest]);
      };
      // A wrapped operation keeps the original's name and own properties, such as `realpathSync.native`, which
      // is wrapped in its turn.
      Object.defineProperty(wrapped, "name", { value: original.name });
      Reflect.set(target, name, Object.assign(wrapped, original));
    }
  };
  wrap(fs, [
    "readFileSync", "readdirSync", "opendirSync", "opendir", "statSync", "lstatSync", "existsSync", "accessSync", "openSync", "realpathSync",
    "readlinkSync", "copyFileSync", "cpSync", "statfsSync", "globSync",
    "readFile", "readdir", "stat", "lstat", "access", "open", "createReadStream", "realpath", "readlink", "copyFile", "cp", "statfs", "glob",
  ]);
  wrap(fs.realpathSync, ["native"]);
  wrap(fs.realpath, ["native"]);
  wrap(fs.promises, ["readFile", "readdir", "stat", "lstat", "access", "open", "opendir", "realpath", "readlink", "copyFile", "cp", "statfs", "glob"]);
  syncBuiltinESMExports();
}

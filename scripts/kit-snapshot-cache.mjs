import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const VERSION = 1;
const digest = (value) => createHash("sha256").update(value).digest("hex");

/** Include actual bytes, including untracked additions and absent/deleted paths. Dependency
 * declarations can change without a lockfile change, so the lockfile alone is insufficient. */
export function snapshotFingerprint(root, config, inputRoots = []) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ version: VERSION, root: realpathSync(root), config }));
  let files = 0;
  let bytes = 0;
  const active = new Set();
  const visit = (directory, dependencies = false) => {
    const physical = realpathSync(directory);
    if (active.has(physical)) throw new Error(`Kit input directory cycle: ${directory}`);
    active.add(physical);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if ([".git", ".cache", ".vite", ".vitest"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      const dependency = dependencies || entry.name === "node_modules";
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") && !dependency) continue;
        visit(path, dependency);
      } else if (entry.isSymbolicLink()) {
        // A symlink can redirect a project or package without changing its logical name.
        const target = realpathSync(path);
        hash.update(JSON.stringify([relative(root, path), target]));
        const linked = readdirIfDirectory(target);
        if (linked) visit(path, dependency);
        else add(path, dependency);
      } else if (entry.isFile()) add(path, dependency);
    }
    active.delete(physical);
  };
  const add = (path, dependencies) => {
    if (dependencies && !/\.(?:[cm]?ts|[cm]?js|json)$/.test(path)) return;
    const content = readFileSync(path);
    hash.update(JSON.stringify([relative(root, path), content.length]));
    hash.update(content);
    files++;
    bytes += content.length;
  };
  visit(root);
  for (const input of [...new Set(inputRoots)].sort()) {
    hash.update(JSON.stringify(["external-input-root", realpathSync(input)]));
    visit(input, true);
  }
  return { key: hash.digest("hex"), files, bytes };
}

function readdirIfDirectory(path) {
  try {
    readdirSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOTDIR") return false;
    throw error;
  }
}

/** Reuse extraction, never a verdict. The caller runs the checker and invokes validate()
 * immediately before accepting its result. Cache corruption or mismatch causes fresh extraction. */
export async function cachedSnapshot(root, config, readSnapshot, inputRoots = []) {
  const started = performance.now();
  const cache = join(root, "node_modules", ".cache", "kit", "snapshot.json");
  const before = snapshotFingerprint(root, config, inputRoots);
  let snapshot;
  let reused = false;
  if (existsSync(cache)) {
    try {
      const stored = JSON.parse(readFileSync(cache, "utf8"));
      if (
        stored.version === VERSION &&
        stored.key === before.key &&
        stored.checksum === digest(stored.payload)
      ) {
        snapshot = JSON.parse(stored.payload);
        reused = true;
      }
    } catch {
      // This is disposable derived data; extraction remains the authority.
    }
  }
  if (!reused) snapshot = await readSnapshot(root, config);
  const validate = () => {
    if (snapshotFingerprint(root, config, inputRoots).key !== before.key)
      throw new Error("Kit inputs changed during checking; rerun gate:changed.");
  };
  validate();
  if (!reused) {
    const payload = JSON.stringify(snapshot);
    mkdirSync(dirname(cache), { recursive: true });
    const temporary = `${cache}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(
        temporary,
        JSON.stringify({ version: VERSION, key: before.key, checksum: digest(payload), payload }),
        { flag: "wx" },
      );
      renameSync(temporary, cache);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return {
    snapshot,
    validate,
    receipt: {
      key: before.key,
      reused,
      files: before.files,
      bytes: before.bytes,
      seconds: (performance.now() - started) / 1000,
    },
  };
}

/** The gate rechecks even a reused snapshot. Limits and debt stay in the checker's result;
 * neither this cache nor its receipt supplies an architectural verdict. */
export async function cachedKitCheck(root, config, readSnapshot, checkSnapshot, inputRoots = []) {
  const cached = await cachedSnapshot(root, config, readSnapshot, inputRoots);
  const started = performance.now();
  const result = await checkSnapshot(cached.snapshot);
  cached.validate();
  return {
    result,
    receipt: { ...cached.receipt, checkSeconds: (performance.now() - started) / 1000 },
  };
}

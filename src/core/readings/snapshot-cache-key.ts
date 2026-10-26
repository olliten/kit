import { createHash } from "node:crypto";
import type { KitConfig } from "../primitives/default-config.js";
import type { CacheEntry, CacheEnvironment, TraceRead, TracedRead } from "../primitives/snapshot-cache.js";

export const CACHE_VERSION = 3;
export const CHANGED = "Kit inputs changed during checking; rerun gate:changed.";
// Stands for the app root inside stored traces and payloads, so worktrees of one repository share entries.
export const ROOT_TOKEN_JSON = JSON.stringify("\u0000kit-root\u0000").slice(1, -1);

export const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

// The posix path from one absolute directory to another.
export function relativePath(from: string, to: string): string {
  const a = from.split("/").filter(Boolean);
  const b = to.split("/").filter(Boolean);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return [...a.slice(common).map(() => ".."), ...b.slice(common)].join("/");
}

export function cacheHeader(root: string, config: KitConfig, environment: CacheEnvironment): string {
  const { cwd } = environment;
  return digest(
    JSON.stringify({
      version: CACHE_VERSION,
      engine: environment.engine,
      node: environment.node,
      typescript: environment.typescript,
      caseSensitive: environment.caseSensitive,
      cwd: cwd === root || cwd.startsWith(`${root}/`) ? relativePath(root, cwd) : cwd,
      platform: environment.platform,
      config,
    }),
  );
}

// The root as JSON text: every mention, and the mentions that are a path ending at or continuing below it.
export function rootPattern(root: string): { readonly any: RegExp; readonly path: RegExp } {
  const escaped = JSON.stringify(root)
    .slice(1, -1)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { any: new RegExp(escaped, "g"), path: new RegExp(`${escaped}(?=[/'\\s:),]|\\\\"|")`, "g") };
}
export const withoutRoot = (text: string, root: string): string =>
  text.replace(rootPattern(root).path, () => ROOT_TOKEN_JSON);
export const withRoot = (text: string, root: string): string =>
  text.replaceAll(ROOT_TOKEN_JSON, () => JSON.stringify(root).slice(1, -1));

// Cheap reads first and file contents last, so a stale candidate is usually rejected before a file is hashed.
const COST: Readonly<Record<string, number>> = {
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

// One read per question; the same question answered two ways means the tree moved during extraction.
export function settle(recorded: Readonly<Record<string, readonly TraceRead[]>>): TracedRead[] {
  const reads = new Map<string, TracedRead>();
  for (const [adapter, list] of Object.entries(recorded))
    for (const read of list) {
      const key = JSON.stringify([adapter, read.operation, read.arguments]);
      const known = reads.get(key);
      if (known === undefined) reads.set(key, { adapter, read });
      else if (JSON.stringify(known.read.result) !== JSON.stringify(read.result)) throw new Error(CHANGED);
    }
  return [...reads.values()].sort((a, b) => (COST[a.read.operation] ?? 5) - (COST[b.read.operation] ?? 5));
}

// A stored entry answers here when its key matches and, if it moved roots, every outside path it read is
// written the same way relative to both.
export function applies(entry: CacheEntry, header: string, root: string): boolean {
  if (entry.header !== header) return false;
  if (!entry.portable) return entry.root === root;
  return entry.externals.every((path) => relativePath(entry.root, path) === relativePath(root, path));
}

// The absolute paths outside the root a trace mentions, by directory: what must stay put for it to move.
export function externalDirectories(root: string, trace: readonly TracedRead[]): string[] {
  const externals = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === "string" && value.startsWith("/") && value !== root && !value.startsWith(`${root}/`))
      externals.add(value.slice(0, value.lastIndexOf("/")) || "/");
  };
  for (const { read } of trace) {
    visit(read.arguments);
    visit(read.result);
  }
  return [...externals].sort();
}

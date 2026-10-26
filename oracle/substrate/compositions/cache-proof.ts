import { DEFAULT_CONFIG, type KitConfig } from "../../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../../src/core/primitives/snapshot.js";
import { compilerWorkspace } from "../../../src/substrate/adapters/compiler.js";
import { filesystem } from "../../../src/substrate/adapters/filesystem.js";
import { cachedKitCheck } from "../../../src/substrate/compositions/cached-check.js";
import { readSnapshot } from "../../../src/substrate/compositions/read-snapshot.js";
import { CACHE_APP, CACHE_IGNORE } from "../../core/primitives/cache-app.js";
import { type TemporaryProject, temporaryProjects } from "../adapters/temporary-project.js";

export const rereaders = { filesystem, compiler: compilerWorkspace };
export const CACHE_CONFIG: KitConfig = { ...DEFAULT_CONFIG, ignore: CACHE_IGNORE };

const projects: TemporaryProject[] = [];

export function removeCacheApps(): void {
  for (const project of projects.splice(0)) project.dispose();
}

// A temporary directory a cache proof works in, removed by removeCacheApps.
export function scratch(prefix: string): string {
  const project = temporaryProjects.open(prefix);
  projects.push(project);
  return project.root;
}

// Writes files under a directory inside one of this proof's scratch directories.
export function writeApp(root: string, files: Readonly<Record<string, string>>): void {
  const project = projects.find((each) => root === each.root || root.startsWith(`${each.root}/`));
  if (project === undefined) throw new Error("Write cache apps only inside a scratch directory.");
  const below = root === project.root ? "" : `${root.slice(project.root.length + 1)}/`;
  project.write(Object.fromEntries(Object.entries(files).map(([path, text]) => [`${below}${path}`, text])));
}

// A cache app with its own store, counting extractions; `run` checks it with the identity checker, so its
// result is the snapshot the checker was given.
export function cacheApp(files: Readonly<Record<string, string>> = CACHE_APP) {
  const scratchRoot = scratch("kit-cache-proof-");
  const root = `${scratchRoot}/app`;
  const cacheDir = `${scratchRoot}/cache`;
  writeApp(root, files);
  let extractions = 0;
  let checks = 0;
  const read = (appRoot: string, config: KitConfig, trace: Parameters<typeof readSnapshot>[2]): Snapshot => {
    extractions++;
    return readSnapshot(appRoot, config, trace);
  };
  const check = (snapshot: Snapshot): Snapshot => {
    checks++;
    return snapshot;
  };
  const run = (config: KitConfig = CACHE_CONFIG) => cachedKitCheck(root, config, read, check, rereaders, { cacheDir });
  return {
    root,
    cacheDir,
    read,
    check,
    run,
    put: (path: string, text: string) => writeApp(root, { [path]: text }),
    counts: () => ({ extractions, checks }),
  };
}

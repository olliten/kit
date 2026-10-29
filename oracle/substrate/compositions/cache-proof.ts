import { DEFAULT_CONFIG, type KitConfig } from "../../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../../src/core/primitives/snapshot.js";
import { compilerWorkspace } from "../../../src/substrate/adapters/compiler.js";
import { filesystem } from "../../../src/substrate/adapters/filesystem.js";
import { type Receipt, cachedKitCheck } from "../../../src/substrate/compositions/cached-check.js";
import { readSnapshot } from "../../../src/substrate/compositions/read-snapshot.js";
import { CACHE_APP, CACHE_IGNORE } from "../../core/primitives/cache-app.js";
import { type TemporaryProject, temporaryProjects } from "../adapters/temporary-project.js";

const rereaders = { filesystem, compiler: compilerWorkspace };
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

// The scratch project holding a path, and the path's place inside it.
function placed(root: string): { readonly project: TemporaryProject; readonly below: string } {
  const project = projects.find((each) => root === each.root || root.startsWith(`${each.root}/`));
  if (project === undefined) throw new Error("Write cache apps only inside a scratch directory.");
  return { project, below: root === project.root ? "" : `${root.slice(project.root.length + 1)}/` };
}

// Writes files under a directory inside one of this proof's scratch directories.
export function writeApp(root: string, files: Readonly<Record<string, string>>): void {
  const { project, below } = placed(root);
  project.write(Object.fromEntries(Object.entries(files).map(([path, text]) => [`${below}${path}`, text])));
}

// Removes a file or directory, if there is one, under a directory inside one of this proof's scratch directories.
export function removeFromApp(root: string, path: string): void {
  const { project, below } = placed(root);
  project.remove(`${below}${path}`);
}

export interface CachedRun {
  readonly result: Snapshot;
  readonly snapshot: Snapshot;
  readonly receipt: Receipt & { readonly checkSeconds: number };
}

// One edit, of a file under an app.
export interface AppEdit {
  readonly path: string;
  readonly text: string;
}

// How one cached check runs: on another app root or cache directory, with the snapshot made a graph JSON
// cannot encode (it holds itself as `self` and the root it was read from as `fixtureRoot`), or with an edit
// made to this app while extraction or checking runs.
export interface CacheRunOptions {
  readonly config?: KitConfig;
  readonly root?: string;
  readonly cacheDir?: string;
  readonly graph?: boolean;
  readonly editDuringRead?: AppEdit;
  readonly editDuringCheck?: AppEdit;
}

export interface CacheApp {
  readonly root: string;
  readonly cacheDir: string;
  // Checks through the cache; the checker is the identity, so the result is the snapshot it was given.
  run(options?: CacheRunOptions): Promise<CachedRun>;
  put(path: string, text: string): void;
  remove(path: string): void;
  // Writes a file under this app's cache directory, as corruption would.
  putCache(path: string, text: string): void;
  counts(): { readonly extractions: number; readonly checks: number };
}

// A cache app with its own store, counting extractions and checks.
export function cacheApp(files: Readonly<Record<string, string>> = CACHE_APP): CacheApp {
  const scratchRoot = scratch("kit-cache-proof-");
  const root = `${scratchRoot}/app`;
  const cacheDir = `${scratchRoot}/cache`;
  writeApp(root, files);
  let extractions = 0;
  let checks = 0;
  const put = (path: string, text: string): void => writeApp(root, { [path]: text });
  const run = (options: CacheRunOptions = {}): Promise<CachedRun> => {
    const { editDuringRead, editDuringCheck } = options;
    const read = (appRoot: string, config: KitConfig, trace: Parameters<typeof readSnapshot>[2]): Snapshot => {
      extractions++;
      const snapshot = readSnapshot(appRoot, config, trace);
      if (editDuringRead !== undefined) put(editDuringRead.path, editDuringRead.text);
      return options.graph === true ? Object.assign(snapshot, { self: snapshot, fixtureRoot: appRoot }) : snapshot;
    };
    const check = (snapshot: Snapshot): Snapshot => {
      if (editDuringCheck !== undefined) put(editDuringCheck.path, editDuringCheck.text);
      else checks++;
      return snapshot;
    };
    return cachedKitCheck(options.root ?? root, options.config ?? CACHE_CONFIG, read, check, rereaders, {
      cacheDir: options.cacheDir ?? cacheDir,
    });
  };
  return {
    root,
    cacheDir,
    run,
    put,
    remove: (path) => removeFromApp(root, path),
    putCache: (path, text) => writeApp(cacheDir, { [path]: text }),
    counts: () => ({ extractions, checks }),
  };
}

export interface CacheRunner {
  // Checks an app through the cache in the store its root resolves to.
  run(root: string): Promise<CachedRun>;
  extractions(): number;
}

// Checks any app through each root's own store, counting the extractions across them.
export function cacheRunner(config: KitConfig = CACHE_CONFIG): CacheRunner {
  let extractions = 0;
  const read = (appRoot: string, readConfig: KitConfig, trace: Parameters<typeof readSnapshot>[2]): Snapshot => {
    extractions++;
    return readSnapshot(appRoot, readConfig, trace);
  };
  return {
    run: (root) => cachedKitCheck(root, config, read, (snapshot: Snapshot) => snapshot, rereaders),
    extractions: () => extractions,
  };
}

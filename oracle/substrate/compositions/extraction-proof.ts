import { DEFAULT_CONFIG, type KitConfig } from "../../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../../src/core/primitives/snapshot.js";
import { evidenceStore } from "../../../src/substrate/adapters/evidence-store.js";
import { type ExtractionReceipt, readSnapshot, readStoredSnapshot } from "../../../src/substrate/compositions/read-snapshot.js";
import { SMALL_APP, SMALL_IGNORE } from "../../core/primitives/small-app.js";
import { type TemporaryProject, temporaryProjects } from "../adapters/temporary-project.js";

export const SMALL_CONFIG: KitConfig = { ...DEFAULT_CONFIG, ignore: SMALL_IGNORE };

// The small app in a temporary project, read through a store of its own beside it, so a proof sees exactly what
// each read reused and can compare it with a read that has no store.
export interface SmallApp {
  readonly root: string;
  readonly store: string;
  put(path: string, text: string): void;
  remove(path: string): void;
  stored(engine?: string): { readonly snapshot: Snapshot; readonly receipt: ExtractionReceipt };
  fresh(): Snapshot;
  // From now on every entry the store holds reads as text that isn't an entry, as a torn or foreign file would.
  corrupt(): void;
  dispose(): void;
}

export function smallApp(files: Readonly<Record<string, string>> = SMALL_APP, shared?: string): SmallApp {
  const project: TemporaryProject = temporaryProjects.open("kit-small-");
  const app = `${project.root}/app`;
  // The store lives outside the app, so the app's own walk never lists it.
  const store = shared ?? `${project.root}/store`;
  project.write(Object.fromEntries(Object.entries(files).map(([path, text]) => [`app/${path}`, text])));
  let unreadable = false;
  const reuse = {
    read: (kind: string, key: string) => {
      const text = evidenceStore.read(store, kind, key);
      return unreadable && text !== undefined ? "{" : text;
    },
    write: (kind: string, key: string, text: string) => evidenceStore.write(store, kind, key, text),
  };
  return {
    root: app,
    store,
    put: (path, text) => project.write({ [`app/${path}`]: text }),
    remove: (path) => project.remove(`app/${path}`),
    stored: (engine = "proof") => readStoredSnapshot(app, SMALL_CONFIG, { reuse, engine }),
    fresh: () => readSnapshot(app, SMALL_CONFIG),
    corrupt: () => {
      unreadable = true;
    },
    dispose: () => project.dispose(),
  };
}

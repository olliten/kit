import { sharedPass, sharedPlace, unshared } from "../../core/readings/shared-passes.js";
import { evidenceStore } from "../adapters/evidence-store.js";
import { gitRefs } from "../adapters/git-refs.js";

const ATTEMPTS = 4;

// What a reading of the shared refs found: how many passes the store gained, the first ref's tip and the paths
// its tree holds, which a publish starts from, or why nothing could be read.
export type SharedReading =
  | { readonly read: number; readonly tip: string | null; readonly held: readonly string[] }
  | { readonly read: 0; readonly failure: string };

// Keeps in the store every pass on the refs that the store lacks, the first ref's first, so a pass another clone
// kept is reused as this clone's own.
export function readSharedPasses(root: string, store: string, refs: readonly string[]): SharedReading {
  try {
    const tips = refs.map((ref) => gitRefs.read(root, ref));
    const wanted = new Map<string, { readonly blob: string; readonly path: string }>();
    for (const tip of tips)
      for (const file of tip?.files ?? []) {
        const place = sharedPlace(file.path);
        if (place !== null && !wanted.has(file.path) && evidenceStore.read(store, place.kind, place.key) === undefined) wanted.set(file.path, file);
      }
    const files = [...wanted.values()];
    const texts = gitRefs.texts(root, files.map((file) => file.blob));
    let read = 0;
    files.forEach((file, index) => {
      const text = texts[index] ?? "";
      const pass = sharedPass(file.path, text);
      if (pass === null) return;
      evidenceStore.write(store, pass.kind, pass.key, text);
      read++;
    });
    const first = tips[0] ?? null;
    return { read, tip: first?.tip ?? null, held: first?.files.map((file) => file.path) ?? [] };
  } catch (error) {
    return { read: 0, failure: error instanceof Error ? error.message : String(error) };
  }
}

// Adds to the ref every pass its tree lacks, as one commit on the tip pushed without force, starting from the tip
// a reading saw. A moved tip is read again and added on top, a few times: the count published, or why not.
export function publishPasses(
  root: string,
  ref: string,
  passes: readonly { readonly path: string; readonly text: string }[],
  seen: { readonly tip: string | null; readonly held: readonly string[] },
): { readonly published: number } | { readonly published: 0; readonly failure: string } {
  let tip = seen.tip;
  let held = seen.held;
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const add = unshared(held, passes);
      if (add.length === 0) return { published: 0 };
      if (gitRefs.advance(root, ref, tip, add, `kit verify: ${add.length} passes\n`) !== null) return { published: add.length };
      const again = gitRefs.read(root, ref);
      tip = again?.tip ?? null;
      held = again?.files.map((file) => file.path) ?? [];
    }
    return { published: 0, failure: `${ref} moved on each of ${ATTEMPTS} pushes` };
  } catch (error) {
    return { published: 0, failure: error instanceof Error ? error.message : String(error) };
  }
}

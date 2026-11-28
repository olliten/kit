import { digest } from "../../core/readings/fact-keys.js";
import { sharedPass, sharedPlace, unshared } from "../../core/readings/shared-passes.js";
import { type GitRefs, gitRefs } from "../adapters/git-refs.js";
import { stopwatch } from "../adapters/stopwatch.js";

const ATTEMPTS = 5;
// The first pause's longest length; each later one is twice as long, so the four pauses come to at most 3.75 s.
const PAUSE_MS = 250;

// The pause before try `attempt + 1`: between half of its longest length and all of it, at a point set by this
// clone's clock and the passes it adds, so two clones that lost one race to each other rarely meet again.
const pauseBefore = (attempt: number, add: readonly { readonly path: string }[]): number => {
  const longest = PAUSE_MS * 2 ** (attempt - 1);
  const point = Number.parseInt(digest(`${stopwatch.now()}\u0000${add.map((pass) => pass.path).join("\u0000")}`).slice(0, 8), 16) / 2 ** 32;
  return longest / 2 + point * (longest / 2);
};

// A pass a shared ref lists: its kind and key in the store, and the blob that holds its text.
export type SharedFile = { readonly kind: string; readonly key: string; readonly path: string; readonly blob: string };

// What a reading of the shared refs found: the passes they list by kind, the first ref's first, the first ref's tip
// and the paths its tree holds, which a publish starts from, or why nothing could be read.
export type SharedReading =
  | { readonly offered: ReadonlyMap<string, readonly SharedFile[]>; readonly tip: string | null; readonly held: readonly string[] }
  | { readonly failure: string };

// Lists the passes on the refs by kind, fetching none: a plan fetches only those of a kind no kept pass holds
// (`fetchSharedPasses`). The clone's copies of other days' refs, which no reading asks for again, go.
export function readSharedPasses(root: string, refs: readonly string[]): SharedReading {
  try {
    const tips = refs.map((ref) => gitRefs.read(root, ref));
    gitRefs.forget(root, refs);
    const seen = new Set<string>();
    const offered = new Map<string, SharedFile[]>();
    for (const tip of tips)
      for (const file of tip?.files ?? []) {
        const place = sharedPlace(file.path);
        if (place === null || seen.has(file.path)) continue;
        seen.add(file.path);
        offered.set(place.kind, [...(offered.get(place.kind) ?? []), { ...place, path: file.path, blob: file.blob }]);
      }
    const first = tips[0] ?? null;
    return { offered, tip: first?.tip ?? null, held: first?.files.map((file) => file.path) ?? [] };
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
}

// The texts of the listed passes, in one fetch, each only when it is a pass kept under its own key, as a torn or
// foreign file isn't; or why they could not be fetched.
export function fetchSharedPasses(
  root: string,
  files: readonly SharedFile[],
): { readonly passes: readonly (SharedFile & { readonly text: string })[] } | { readonly failure: string } {
  if (files.length === 0) return { passes: [] };
  try {
    const texts = gitRefs.texts(root, files.map((file) => file.blob));
    return {
      passes: files.flatMap((file, index) => {
        const text = texts[index] ?? "";
        return sharedPass(file.path, text) === null ? [] : [{ ...file, text }];
      }),
    };
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
}

// Adds to the ref every pass its tree lacks, as one commit on the tip pushed without force, starting from the tip
// a reading, or the last addition, saw. A moved tip is read again and added on top, a few times, each after a
// longer random pause: the count published with the tip and paths the ref now holds, which the next addition
// starts from, or why not. A race lost on every try also gives the tip and paths last read, as `lost`, so a later
// addition starts from them; any other failure gives none.
export function publishPasses(
  root: string,
  ref: string,
  passes: readonly { readonly path: string; readonly text: string }[],
  seen: { readonly tip: string | null; readonly held: readonly string[] },
  refs: GitRefs = gitRefs,
):
  | { readonly published: number; readonly tip: string | null; readonly held: readonly string[] }
  | { readonly published: 0; readonly failure: string; readonly lost?: { readonly tip: string | null; readonly held: readonly string[] } } {
  let tip = seen.tip;
  let held = seen.held;
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const add = unshared(held, passes);
      if (add.length === 0) return { published: 0, tip, held };
      const advanced = refs.advance(root, ref, tip, add, `kit verify: ${add.length} passes\n`);
      if (advanced !== null) return { published: add.length, tip: advanced, held: [...held, ...add.map((pass) => pass.path)] };
      if (attempt < ATTEMPTS) stopwatch.pause(pauseBefore(attempt, add));
      const again = refs.read(root, ref);
      tip = again?.tip ?? null;
      held = again?.files.map((file) => file.path) ?? [];
    }
    return { published: 0, failure: `${ref} moved on each of ${ATTEMPTS} pushes`, lost: { tip, held } };
  } catch (error) {
    return { published: 0, failure: error instanceof Error ? error.message : String(error) };
  }
}

import type { FunctionSpan } from "../../core/primitives/function-span.js";
import { ranState } from "../../core/readings/ran-code.js";
import { KIT_KEY, heldPath } from "../../core/readings/verdict-reuse.js";
import { compilerWorkspace } from "../adapters/compiler.js";
import { filesystem } from "../adapters/filesystem.js";
import { textFiles } from "../adapters/text-files.js";

// What kept keys' paths in the app hold now, for one run: a path's content, its kind, or its code as the functions
// a run ran see it, and a script's outermost functions.
export interface HeldStates {
  state(key: string): string;
  // A script's outermost functions, or none when it is absent.
  functions(path: string): readonly FunctionSpan[] | undefined;
  // The file system's own time at a moment before every read that follows.
  since(time: number): void;
  // How many states were read, and how many were known from an earlier read of the same version.
  readonly receipt: { readonly read: number; readonly reused: number };
}

// Each key's state, and each script's functions, are read once per version of its path. A version is trusted only
// when it changed before the last time `since` gave: a later edit then lands in a later tick and so changes the
// version, while one in the tick it changed in could leave it the same, so a path changed since is read each time.
// A pass that loaded the code of a Kit outside the app holds that Kit's source, given as `kit`, under its own key.
export function heldStates(root: string, kit = ""): HeldStates {
  let mark = -Infinity;
  const receipt = { read: 0, reused: 0 };
  const states = new Map<string, { readonly id: string; readonly state: string }>();
  const spans = new Map<string, { readonly id: string; readonly spans: readonly FunctionSpan[] }>();
  // The last script read, for its other keys and its functions: keys of one path sort together.
  let last: { readonly path: string; readonly id: string; readonly text: string } | undefined;
  const at = (path: string): string => (path === "." ? root : `${root}/${path}`);
  const trusted = (path: string): string | undefined => {
    const version = filesystem.version(at(path));
    return version !== undefined && version.changed < mark ? version.id : undefined;
  };
  const text = (path: string, id: string | undefined): string => {
    if (id !== undefined && last?.path === path && last.id === id) return last.text;
    const read = textFiles.read(at(path));
    last = id === undefined ? undefined : { path, id, text: read };
    return read;
  };
  const code = (path: string, id: string | undefined, ran: readonly number[]): string => {
    if (!textFiles.exists(at(path))) return "absent";
    const read = text(path, id);
    return ranState(path, compilerWorkspace.code(path, read), compilerWorkspace.outermostFunctions(path, read), ran);
  };
  return {
    state(key) {
      if (key === KIT_KEY) return kit;
      const { path, kind, ran } = heldPath(key);
      if (kind) return filesystem.kind(at(path));
      const id = trusted(path);
      const known = id === undefined ? undefined : states.get(key);
      if (known !== undefined && known.id === id) {
        receipt.reused++;
        return known.state;
      }
      receipt.read++;
      const state = ran === undefined ? filesystem.state(at(path)) : code(path, id, ran);
      if (id !== undefined) states.set(key, { id, state });
      return state;
    },
    functions(path) {
      if (!textFiles.exists(at(path))) return undefined;
      const id = trusted(path);
      const known = id === undefined ? undefined : spans.get(path);
      if (known !== undefined && known.id === id) return known.spans;
      const found = compilerWorkspace.outermostFunctions(path, text(path, id));
      if (id !== undefined) spans.set(path, { id, spans: found });
      return found;
    },
    since(time) {
      mark = time;
    },
    receipt,
  };
}

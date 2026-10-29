import { ranState } from "../../core/readings/ran-code.js";
import { heldPath } from "../../core/readings/verdict-reuse.js";
import { compilerWorkspace } from "../adapters/compiler.js";
import { filesystem } from "../adapters/filesystem.js";
import { textFiles } from "../adapters/text-files.js";

// What a kept key's path in the app holds now: its content, its kind, or its text as the functions a run ran
// see it.
export function heldState(root: string, key: string): string {
  const { path, kind, ran } = heldPath(key);
  const at = `${root}/${path}`;
  if (kind) return filesystem.kind(at);
  if (ran === undefined) return filesystem.state(at);
  if (!textFiles.exists(at)) return "absent";
  const text = textFiles.read(at);
  return ranState(text, compilerWorkspace.outermostFunctions(path, text), ran);
}

import type { SnapshotComment } from "../../src/core/primitives/comment.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import type { ExportedSymbol } from "../../src/core/primitives/exported-symbol.js";
import type { SpecProse } from "../../src/core/primitives/file.js";
import type { ImportEdge } from "../../src/core/primitives/import.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import type { SpecTerm } from "../../src/core/primitives/term.js";

// The one snapshot builder for headless tests: source files under src/, tests (`*.test.ts`) under
// oracle/, imports as "from > to", terms as
// "<term>" or "<term> · retired: <word>, <word>" (one terms-file line each), prose as the text of
// spec/topic.md, exported symbols as "file#name", and comments as "file#text" (each on line 1).
export function snapshotOf(parts: {
  files?: readonly string[];
  imports?: readonly string[];
  terms?: readonly string[];
  prose?: readonly string[];
  symbols?: readonly string[];
  comments?: readonly string[];
  claims?: Snapshot["claims"];
}): Snapshot {
  const files = (parts.files ?? []).map((path) => ({
    path,
    type: path.endsWith(".test.ts") ? ("test" as const) : ("source" as const),
  }));
  const imports: ImportEdge[] = (parts.imports ?? []).map((edge) => {
    const [from = "", to = ""] = edge.split(" > ");
    return { from, to };
  });
  const terms: SpecTerm[] = (parts.terms ?? []).map((entry, i) => {
    const [term = "", words] = entry.split(" · retired: ");
    const retired = words === undefined ? [] : words.split(", ");
    return { term, meaning: "", retired, line: i + 1 };
  });
  const prose: SpecProse[] = (parts.prose ?? []).map((text) => ({ file: "spec/topic.md", text }));
  const symbols: ExportedSymbol[] = (parts.symbols ?? []).map((symbol) => {
    const [file = "", name = ""] = symbol.split("#");
    return { file, name };
  });
  const comments: SnapshotComment[] = (parts.comments ?? []).map((comment) => {
    const [file = "", ...text] = comment.split("#");
    return { file, line: 1, text: text.join("#") };
  });
  return {
    files,
    imports,
    terms,
    prose,
    symbols,
    comments,
    config: DEFAULT_CONFIG,
    ...(parts.claims === undefined ? {} : { claims: parts.claims }),
  };
}

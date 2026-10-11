import { DEFAULT_CONFIG } from "../../src/core/data/default-config.js";
import type {
  ExportedSymbol,
  ImportEdge,
  Snapshot,
  SpecHeading,
  SpecProse,
  SpecTerm,
} from "../../src/core/reading/snapshot.js";

// The one snapshot builder for headless tests: source files under src/, tests (`*.test.ts`) under
// oracle/, imports as "from > to", headings as artifact names in spec/topic.md, terms as
// "<term>" or "<term> · retired: <word>, <word>" (one terms-file line each), prose as the text of
// spec/topic.md, and exported symbols as "file#name".
export function snapshotOf(parts: {
  files?: readonly string[];
  imports?: readonly string[];
  headings?: readonly string[];
  terms?: readonly string[];
  prose?: readonly string[];
  symbols?: readonly string[];
}): Snapshot {
  const files = (parts.files ?? []).map((path) => ({
    path,
    type: path.endsWith(".test.ts") ? ("test" as const) : ("source" as const),
  }));
  const imports: ImportEdge[] = (parts.imports ?? []).map((edge) => {
    const [from = "", to = ""] = edge.split(" > ");
    return { from, to };
  });
  const headings: SpecHeading[] = (parts.headings ?? []).map((name) => ({
    file: "spec/topic.md",
    name,
  }));
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
  return { files, imports, headings, terms, prose, symbols, config: DEFAULT_CONFIG };
}

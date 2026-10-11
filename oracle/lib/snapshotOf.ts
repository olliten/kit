import { DEFAULT_CONFIG } from "../../src/core/data/defaultConfig.js";
import type { ImportEdge, Snapshot, SpecHeading } from "../../src/core/reading/snapshot.js";

// The one snapshot builder for headless tests: source files under src/, tests (`*.test.ts`) under
// oracle/, imports as "from > to", headings as artifact names in spec/topic.md.
export function snapshotOf(parts: {
  files?: readonly string[];
  imports?: readonly string[];
  headings?: readonly string[];
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
  return { files, imports, headings, config: DEFAULT_CONFIG };
}

import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { legacyCodeOf, placementOf, rootOf } from "./placement-of.js";

export interface FunctionSizeFinding extends Finding {
  readonly category: "placed-violation" | "legacy-debt";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
  readonly lines: number;
}

// A function body too long to hold at once is read in pieces, and its parts can't be named, moved or proved
// apart. A named function's span includes everything it holds, so code moved into an inline closure, or a named
// one, stays its weight; only code moved out of the body leaves it. Tests are left out, since a test's cases
// are read one at a time. With no limit declared, nothing is measured, since a fitting limit depends on the app.
export function functionSize(snapshot: Snapshot): FunctionSizeFinding[] {
  const { srcRoot, layerNames, layout, limits } = snapshot.config;
  if (limits === undefined) return [];
  const most = limits.functionLines;
  const sources = new Set(snapshot.files.filter((file) => file.type === "source").map((file) => file.path));
  const measured = new Map<string, FunctionSizeFinding>();
  for (const { file, id, lines } of (snapshot.compiler?.projects ?? []).flatMap((project) => project.functions ?? [])) {
    if (lines <= most || !sources.has(file) || (rootOf(file, srcRoot) === undefined && !legacyCodeOf(file, layout?.legacy)))
      continue;
    const found = {
      ...finding(
        "R3",
        "function-size",
        file,
        `${id} spans ${lines} lines, over the limit of ${most}: move parts of it into functions declared outside its body.`,
        id,
      ),
      category: placementOf(file, srcRoot, layerNames).placed ? ("placed-violation" as const) : ("legacy-debt" as const),
      status: "violation" as const,
      blocking: true as const,
      limit: "" as const,
      lines,
    };
    measured.set(found.debtKey, found);
  }
  return [...measured.values()].sort(byDebtKey);
}

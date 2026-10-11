import { KINDS, PUBLIC_CORE_KINDS } from "../data/kinds.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { type Placed, kindOf } from "./kind-of.js";
import type { Snapshot } from "./snapshot.js";

// R2, dependencies. Only imports between two placed artifacts are held; legacy files are not.
// - Within a zone: data ← state ← reading ← change ← effect. A module imports its own kind or an
//   earlier one, never a later one.
// - Across zones: only inward to the core, and only to its data, readings and changes (core state is
//   private). The core imports no other zone; shell and substrate never import each other.
// - Acyclic: no import cycle among placed artifacts.
export function dependencyCheck(snapshot: Snapshot): Finding[] {
  const { srcRoot } = snapshot.config;
  const edges: [Placed, Placed][] = [];
  for (const { from, to } of snapshot.imports) {
    const a = kindOf(from, srcRoot);
    const b = kindOf(to, srcRoot);
    if (a.placed && b.placed) edges.push([a, b]);
  }

  const findings: Finding[] = [];
  for (const [a, b] of edges) {
    const fix = edgeFix(a, b);
    if (fix !== undefined) findings.push(finding("R2", "edge", a.artifact, fix, b.artifact));
  }
  for (const cycle of cycles(edges)) {
    const path = cycle[0] ?? "";
    const fix = `Break the import cycle ${[...cycle, path].join(" → ")}: move what they share into one artifact or an earlier kind.`;
    findings.push(finding("R2", "cycle", path, fix, cycle.join(",")));
  }
  // One finding per debt key, however many times a file repeats an import.
  return [...new Map(findings.map((f) => [f.debtKey, f])).values()].sort(byDebtKey);
}

function edgeFix(a: Placed, b: Placed): string | undefined {
  const edge = `${a.artifact} imports ${b.artifact}`;
  if (a.zone === b.zone) {
    if (KINDS.indexOf(b.kind) <= KINDS.indexOf(a.kind)) return undefined;
    return `${edge}, a later kind: move the shared part to ${a.zone}/${a.kind} or earlier, or invert the call.`;
  }
  if (a.zone === "core") {
    return `${edge}, outside the core: the core imports no other zone; have ${b.zone} call the core instead.`;
  }
  if (b.zone !== "core") {
    return `${edge}: ${a.zone} and ${b.zone} never import each other; meet through a core data, reading or change.`;
  }
  if (PUBLIC_CORE_KINDS.includes(b.kind)) return undefined;
  return `${edge}: core ${b.kind} is private to the core; depend on a core reading or change instead.`;
}

// The strongly connected components with more than one artifact, or one that imports itself (Tarjan).
// Each cycle lists its artifacts sorted; the cycles come sorted by their first artifact.
function cycles(edges: readonly [Placed, Placed][]): string[][] {
  const next = new Map<string, string[]>();
  for (const [a, b] of edges) {
    next.set(a.artifact, [...(next.get(a.artifact) ?? []), b.artifact]);
    if (!next.has(b.artifact)) next.set(b.artifact, []);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];

  const visit = (v: string): void => {
    index.set(v, index.size);
    low.set(v, index.get(v) ?? 0);
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
      }
    }
    if (low.get(v) !== index.get(v)) return;
    const component: string[] = [];
    let w: string | undefined;
    do {
      w = stack.pop();
      if (w === undefined) break;
      onStack.delete(w);
      component.push(w);
    } while (w !== v);
    if (component.length > 1 || (next.get(v) ?? []).includes(v)) found.push(component.sort());
  };
  for (const v of [...next.keys()].sort()) if (!index.has(v)) visit(v);
  return found.sort((x, y) => ((x[0] ?? "") < (y[0] ?? "") ? -1 : 1));
}

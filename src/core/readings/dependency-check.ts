import { type Finding, byDebtKey, finding } from "./finding.js";
import { LAYERS, type Placed, placementOf } from "./placement-of.js";
import type { Snapshot } from "./snapshot.js";

// R2, dependencies. Only imports between two placed artifacts are held; legacy files are not.
// - Within a zone: imports point to the same layer or a lower one.
// - Across zones: imports point inward to the core.
// - Acyclic: no import cycle among placed artifacts.
export function dependencyCheck(snapshot: Snapshot): Finding[] {
  const { srcRoot } = snapshot.config;
  const edges: [Placed, Placed][] = [];
  for (const { from, to } of snapshot.imports) {
    const a = placementOf(from, srcRoot);
    const b = placementOf(to, srcRoot);
    if (a.placed && b.placed) edges.push([a, b]);
  }

  const findings: Finding[] = [];
  for (const [a, b] of edges) {
    const fix = edgeFix(a, b);
    if (fix !== undefined) findings.push(finding("R2", "edge", a.artifact, fix, b.artifact));
  }
  for (const cycle of cycles(edges.map(([a, b]) => [a.artifact, b.artifact]))) {
    const path = cycle[0] ?? "";
    const fix = `Break the import cycle ${[...cycle, path].join(" → ")}: move what they share into one artifact or a lower layer.`;
    findings.push(finding("R2", "cycle", path, fix, cycle.join(",")));
  }
  // One finding per debt key, however many times a file repeats an import.
  return [...new Map(findings.map((f) => [f.debtKey, f])).values()].sort(byDebtKey);
}

function edgeFix(a: Placed, b: Placed): string | undefined {
  const edge = `${a.artifact} imports ${b.artifact}`;
  if (a.zone === b.zone) {
    if (LAYERS.indexOf(b.layer) <= LAYERS.indexOf(a.layer)) return undefined;
    return `${edge}, a higher layer: move the shared part to ${a.zone}/${a.layer} or lower, or invert the call.`;
  }
  if (a.zone === "core") {
    return `${edge}, outside the core: the core imports no other zone; have ${b.zone} call the core instead.`;
  }
  if (b.zone !== "core") {
    return `${edge}: ${a.zone} and ${b.zone} never import each other; meet through a core contract.`;
  }
  return undefined;
}

// The strongly connected components with more than one artifact, or one that imports itself (Tarjan).
// Each cycle lists its artifacts sorted; the cycles come sorted by their first artifact.
export function cycles(edges: readonly [string, string][]): string[][] {
  const next = new Map<string, string[]>();
  for (const [a, b] of edges) {
    next.set(a, [...(next.get(a) ?? []), b]);
    if (!next.has(b)) next.set(b, []);
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

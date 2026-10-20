import { type Finding, byDebtKey, finding } from "./finding.js";
import { type Placed, placementOf, rootOf } from "./placement-of.js";

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

export function dependencyExclusions(snapshot: Snapshot): {
  readonly findings: readonly Finding[];
  readonly limits: readonly Finding[];
} {
  const rules = snapshot.config.dependencyExclusions ?? [];
  const findings: Finding[] = [];
  const limits: Finding[] = [];
  if (rules.length === 0) return { findings, limits };
  const local = new Set(
    snapshot.files
      .filter((file) => file.type === "source" || file.type === "test")
      .map((file) => file.path),
  );
  const analyzed = new Set(
    snapshot.files
      .filter(
        (file) =>
          file.type === "source" ||
          (file.type === "test" && snapshot.config.exceptions?.includes(file.path)),
      )
      .map((file) => file.path),
  );
  const projects = snapshot.compiler?.projects ?? [];
  const covered = new Set(
    projects.flatMap((project) => [...project.files, ...project.ambientFiles]),
  );
  const edges = new Map<
    string,
    NonNullable<Snapshot["compiler"]>["projects"][number]["imports"][number][]
  >();
  for (const edge of projects.flatMap((project) => project.imports)) {
    const found = edges.get(edge.file) ?? [];
    found.push(edge);
    edges.set(edge.file, found);
  }
  const selects = (selector: string, path: string): boolean =>
    path === selector || path.startsWith(`${selector}/`);
  for (const rule of rules) {
    if (
      typeof rule.from !== "string" ||
      typeof rule.to !== "string" ||
      !["all", "runtime"].includes(rule.imports) ||
      !["direct", "transitive"].includes(rule.reach)
    )
      throw new Error(
        "Declare dependency exclusions with from, to, imports (all/runtime) and reach (direct/transitive).",
      );
    const from = rule.from.replace(/\/$/, "");
    const to = rule.to.replace(/\/$/, "");
    rootOf("", [from]);
    rootOf("", [to]);
    const origins = [...analyzed].filter((path) => selects(from, path));
    if (origins.length === 0 || ![...local].some((path) => selects(to, path)))
      throw new Error(
        "Dependency exclusion selectors must match existing code; proof origins must be declared entrypoints.",
      );
    for (const origin of origins) {
      const pending = [[origin]];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const route = pending.pop() ?? [];
        const file = route[route.length - 1] ?? origin;
        if (visited.has(file)) continue;
        visited.add(file);
        if (!analyzed.has(file) || !covered.has(file)) {
          limits.push(
            finding(
              "R2",
              "dependency-boundary",
              origin,
              `No checked import evidence establishes ${route.join(" → ")}.`,
              file,
            ),
          );
          continue;
        }
        for (const edge of edges.get(file) ?? []) {
          if (rule.imports === "runtime" && edge.typeOnly === true) continue;
          const target = edge.target ?? (rule.reach === "direct" ? edge.declarationTarget ?? null : null);
          const packageName = edge.specifier.startsWith("@")
            ? edge.specifier.split("/").slice(0, 2).join("/")
            : edge.specifier.split("/")[0];
          const classifiedPackage =
            rule.reach === "direct" &&
            target === null &&
            !/^[.#/]/.test(edge.specifier) &&
            (snapshot.config.packages?.some((row) => row.name === packageName) ||
              snapshot.config.adapters?.some((row) => row.packages?.includes(packageName ?? "")));
          if (classifiedPackage && (rule.imports === "all" || edge.typeOnly === false)) continue;
          if (target === null || (rule.imports === "runtime" && edge.typeOnly !== false)) {
            limits.push(
              finding(
                "R2",
                "dependency-boundary",
                origin,
                `Establish the import boundary ${[...route, edge.specifier].join(" → ")}.`,
                `${file}:${edge.specifier}`,
              ),
            );
            continue;
          }
          const next = [...route, target];
          if (selects(to, target)) {
            findings.push(
              finding(
                "R2",
                "dependency-exclusion",
                origin,
                `Remove the forbidden ${rule.imports} dependency ${next.join(" → ")}.`,
                `${rule.imports}:${rule.reach}:${target}`,
              ),
            );
          } else if (rule.reach === "transitive") pending.push(next);
        }
      }
    }
  }
  const unique = (items: readonly Finding[]) =>
    [...new Map(items.map((item) => [item.debtKey, item])).values()].sort(byDebtKey);
  return { findings: unique(findings), limits: unique(limits) };
}

function edgeFix(a: Placed, b: Placed): string | undefined {
  const edge = `${a.artifact} imports ${b.artifact}`;
  if (a.layer === "adapters" && b.layer !== "primitives") {
    return `${edge}: adapters depend only on primitive data contracts; keep calculations and workflow assembly in readings and compositions.`;
  }
  if (a.zone === b.zone) {
    if (
      a.layer === "compositions" ||
      b.layer === "primitives" ||
      (a.layer === "readings" && b.layer === "readings")
    )
      return undefined;
    return `${edge}, outside its permitted layers: move the shared data to primitives, or assemble the behavior in a composition.`;
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
import type { Snapshot } from "../primitives/snapshot.js";

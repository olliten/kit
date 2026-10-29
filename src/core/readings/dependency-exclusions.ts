import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { entrypointOf, rootOf } from "./placement-of.js";

// Explicit separations an app declares between selected code: which imports may not cross, directly or
// through helpers, and where the compiler gives too little evidence to tell.
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
          (file.type === "test" &&
            entrypointOf(file.path, snapshot.config.exceptions ?? [], snapshot.config.oracleRoot)),
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

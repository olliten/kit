import type { Snapshot } from "../primitives/snapshot.js";
import { type CapabilityContext, type CapabilityFinding, capabilityFinding, capabilityLimit, placed, zoneOf } from "./capability-context.js";
import { cycles } from "./dependency-check.js";

// The import edges among checked code: no module imports an entrypoint, layers depend down or sideways within a
// zone and inward across zones, an edge between legacy and placed code keeps zone boundaries once the legacy
// end has a declared zone, and the layered graph has no cycle. Cross-zone failures are kept so the zone check
// doesn't report them again. A declared harness is zone-less test code until it is placed: an edge from a module
// under one, or from a test to one, asks no zone of it.
export function edgeCheck(
  snapshot: Snapshot,
  context: CapabilityContext,
): { readonly crossZoneFailures: ReadonlySet<string>; readonly findings: readonly CapabilityFinding[] } {
  const checked = new Set(context.files);
  const { startups } = context;
  const crossZoneFailures = new Set<string>();
  const findings: CapabilityFinding[] = [];
  const add = (check: string, path: string, fix: string, detail: string): void => {
    findings.push(capabilityFinding(snapshot, startups, "R2", check, path, fix, detail));
  };
  const unresolved = (path: string, limit: string, detail: string): void => {
    findings.push(capabilityLimit("migration-zone", path, limit, detail));
  };
  const imports = (snapshot.compiler?.projects ?? []).flatMap((project) => project.imports);
  const harnesses = snapshot.config.harnesses ?? [];
  const inHarness = (path: string): boolean =>
    harnesses.some((harness) => ("file" in harness ? path === harness.file : path.startsWith(harness.under)));
  const tests = new Set(snapshot.files.filter((file) => file.type === "test").map((file) => file.path));
  const harnessed = (from: string, to: string): boolean => inHarness(from) || (tests.has(from) && inHarness(to));
  for (const edge of imports) {
    const from = placed(snapshot, edge.file);
    const to = edge.target === null ? null : placed(snapshot, edge.target);
    if (edge.target !== null && startups.includes(edge.target) && checked.has(edge.file))
      add("startup-import", edge.file, "Keep executable entrypoints outside the imported module graph.", edge.target);
    if (
      startups.includes(edge.file) &&
      edge.target !== null &&
      checked.has(edge.target) &&
      zoneOf(snapshot, edge.target) === undefined &&
      !harnessed(edge.file, edge.target)
    )
      unresolved(edge.file, "Startup wiring does not establish a zone for its dependencies.", edge.target);
    if (
      from !== null &&
      to !== null &&
      ((from.layer === "adapters" && to.layer !== "primitives") ||
        (from.zone === to.zone
          ? !(from.layer === "compositions" || to.layer === "primitives" || (from.layer === "readings" && to.layer === "readings"))
          : from.zone === "core" || to.zone !== "core"))
    )
      add("layer-edge", edge.file, "Depend down or sideways within this zone, or inward on a public core contract.", edge.target ?? "");
    if (
      edge.target !== null &&
      checked.has(edge.file) &&
      checked.has(edge.target) &&
      !startups.includes(edge.file) &&
      !startups.includes(edge.target) &&
      (from === null) !== (to === null)
    ) {
      const fromZone = zoneOf(snapshot, edge.file);
      const toZone = zoneOf(snapshot, edge.target);
      if (fromZone === undefined || toZone === undefined) {
        if (!harnessed(edge.file, edge.target))
          unresolved(
            edge.file,
            "Declare the legacy prefix's actual zone before establishing this cross-placement boundary.",
            edge.target,
          );
      } else if (fromZone !== toZone && (fromZone === "core" || toZone !== "core")) {
        crossZoneFailures.add(`${edge.file}:${edge.target}`);
        add(
          "zone-edge",
          edge.file,
          "Keep cross-placement imports in the same zone or point inward to core; legacy placement grants no outer-zone access.",
          edge.target,
        );
      }
    }
  }
  for (const cycle of cycles(
    imports.flatMap((edge): [string, string][] =>
      edge.target !== null && checked.has(edge.file) && checked.has(edge.target) ? [[edge.file, edge.target]] : [],
    ),
  )) {
    const path = cycle[0];
    if (path !== undefined)
      add("cycle", path, "Break this layered module import cycle through a shared lower contract.", cycle.join(","));
  }
  return { crossZoneFailures, findings };
}

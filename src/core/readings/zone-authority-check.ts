import type { Snapshot } from "../primitives/snapshot.js";
import type { AuthorityGraph } from "./authority-graph.js";
import {
  type CapabilityContext,
  type CapabilityFinding,
  HOST_LIBRARY,
  WINDOW_AUTHORITY,
  capabilityFinding,
  capabilityLimit,
  placed,
  zoneOf,
} from "./capability-context.js";
import { permits } from "./zone-permission.js";

// What each placed module, entrypoint and legacy edge holds must be permitted where it is: Window-only authority
// in Shell, native roots behind a matching adapter, no capability in a reading, and every other capability in a
// zone an adapter permits. Inside an adapter, a native root must come through its contract or a host global it
// declares; a declared host global covers every handle reached through it.
export function zoneAuthorityCheck(
  snapshot: Snapshot,
  context: CapabilityContext,
  graph: AuthorityGraph,
): CapabilityFinding[] {
  const projects = snapshot.compiler?.projects ?? [];
  const { natives, startups } = context;
  const findings: CapabilityFinding[] = [];
  const add = (check: string, path: string, fix: string, detail?: string): void => {
    findings.push(capabilityFinding(snapshot, startups, "R1", check, path, fix, detail));
  };
  const allowed = (path: string, capability: string): boolean => permits(snapshot, context, path, capability);
  const runtimeGlobals = (path: string, names: readonly string[]) =>
    projects.flatMap((project) =>
      project.globals.filter((global) => global.file === path && global.runtime && names.includes(global.name)),
    );
  for (const [path, capabilities] of graph.internalNative)
    for (const capability of capabilities) {
      const native = natives.get(capability);
      if (native === undefined) continue;
      const covered = context.adapters.some(({ adapter, path: home, contracts }) => {
        if (home !== path || adapter.kind !== "external") return false;
        const declared = runtimeGlobals(path, adapter.globals ?? []);
        if (HOST_LIBRARY.test(native.root.file) && declared.some((global) => HOST_LIBRARY.test(global.declarationFile ?? "")))
          return true;
        // The window object itself needs a declared global, whatever the contract's types mention.
        return [
          ...(graph.globalWindow.has(`${path}:${capability}`) ? [] : contracts.flatMap((contract) => contract.nativeAuthority ?? [])),
          ...declared.flatMap((global) => global.nativeAuthority ?? []),
        ].some((accepted) => native.root.file === accepted.root.file && native.root.name === accepted.root.name);
      });
      if (!covered)
        findings.push(
          capabilityLimit(
            "native-authority",
            path,
            "This adapter's native SDK authority is outside its contract and declared globals.",
            capability,
          ),
        );
    }
  for (const [path, capabilities] of graph.inherited) {
    if (placed(snapshot, path) === null && !startups.includes(path)) continue;
    for (const capability of capabilities) {
      if (capability === WINDOW_AUTHORITY && !allowed(path, capability)) {
        add(
          "window-authority",
          path,
          "Keep Window-only host authority in Shell; adapter declarations cannot grant it to another zone.",
        );
        continue;
      }
      if (natives.has(capability)) {
        if (!allowed(path, capability))
          findings.push(
            capabilityLimit(
              "native-authority",
              path,
              "This native SDK handle grants authority outside a matching permitted adapter boundary.",
              capability,
            ),
          );
        continue;
      }
      const reading = placed(snapshot, path)?.layer === "readings";
      if (reading)
        add(
          "reading-authority",
          path,
          allowed(path, capability)
            ? "Move this capability out of the reading and supply its result as data."
            : "Move this capability to a permitted zone outside the reading and supply its result as data.",
          capability,
        );
      else if (!allowed(path, capability) && !graph.rawFailures.has(`${path}:${capability}`))
        add("zone-authority", path, "Connect this capability in a zone permitted to use it.", capability);
    }
  }
  // An import between legacy and placed code carries the placed side's capabilities into the legacy zone.
  for (const edge of graph.edges) {
    if (graph.crossZoneFailures.has(`${edge.file}:${edge.target}`)) continue;
    if (placed(snapshot, edge.file) !== null || placed(snapshot, edge.target) === null) continue;
    if (zoneOf(snapshot, edge.file) === undefined) continue;
    for (const capability of graph.inherited.get(edge.target) ?? []) {
      if (allowed(edge.file, capability) || graph.rawFailures.has(`${edge.file}:${capability}`)) continue;
      if (natives.has(capability))
        findings.push(
          capabilityLimit(
            "native-authority",
            edge.file,
            "This cross-placement dependency grants native authority outside its legacy zone's permitted capability boundary.",
            capability,
          ),
        );
      else
        add(
          "zone-authority",
          edge.file,
          "Supply data across this boundary instead of importing a capability the legacy zone does not permit.",
          capability,
        );
    }
  }
  return findings;
}

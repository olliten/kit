import type { Snapshot } from "../primitives/snapshot.js";
import { type Adapter, type CapabilityContext, WINDOW_AUTHORITY, adapterPath, placed, zoneOf } from "./capability-context.js";

// A declared core producer builds write descriptions as data and holds no other authority.
export function coreProducer(snapshot: Snapshot, adapter: Adapter): boolean {
  const at = placed(snapshot, adapterPath(snapshot, adapter.module));
  return (
    adapter.kind === "produce" &&
    at?.zone === "core" &&
    at.layer === "compositions" &&
    adapter.zones.includes("core") &&
    (adapter.primitives?.length ?? 0) === 0 &&
    (adapter.globals?.length ?? 0) === 0
  );
}

// Whether code at `path` may hold a capability: its zone must be one a registered adapter of that capability
// permits, Window-only authority stays in Shell, a native root needs an adapter whose contract establishes it,
// and a declared entrypoint may wire Shell and Substrate and use its entrypoint packages.
export function permits(snapshot: Snapshot, context: CapabilityContext, path: string, capability: string): boolean {
  const startup = context.startups.includes(path);
  if (
    startup &&
    (snapshot.config.packages ?? []).some(
      (row) => row.entrypointExports !== undefined && row.capabilities.includes(capability),
    )
  )
    return true;
  const zone = zoneOf(snapshot, path);
  const permittedZones: readonly string[] = startup ? ["shell", "substrate"] : zone === undefined ? [] : [zone];
  if (permittedZones.length === 0) return false;
  if (capability === WINDOW_AUTHORITY) return permittedZones.includes("shell");
  const native = context.natives.get(capability);
  if (native?.windowOnly === true && !permittedZones.includes("shell")) return false;
  if (native !== undefined)
    return (
      permittedZones.some((allowed) => allowed !== "core") &&
      placed(snapshot, path)?.layer !== "readings" &&
      context.adapters.some(
        ({ adapter, contracts }) =>
          adapter.kind === "external" &&
          adapter.zones.some((allowed) => allowed !== "core" && permittedZones.includes(allowed)) &&
          contracts.some((contract) =>
            (contract.nativeAuthority ?? []).some(
              (accepted) => native.root.file === accepted.root.file && native.root.name === accepted.root.name,
            ),
          ),
      )
    );
  return context.adapters.some(
    ({ adapter }) =>
      adapter.capability === capability &&
      (adapter.kind === "produce"
        ? coreProducer(snapshot, adapter) &&
          (placed(snapshot, path)?.layer === "compositions" || placed(snapshot, path) === null)
        : adapter.zones.some((allowed) => allowed !== "core" && permittedZones.includes(allowed))),
  );
}

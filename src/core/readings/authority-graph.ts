import type { Snapshot } from "../primitives/snapshot.js";
import { type AuthorityPart, type CapabilityContext, WINDOW_AUTHORITY, nativeKey } from "./capability-context.js";

// What each checked file can do: the capabilities its own code acquires, and those it inherits through runtime
// imports. Native roots an adapter reaches are kept apart, for the adapter check; failures already reported at
// their cause are kept so the zone check doesn't report them twice.
export interface AuthorityGraph {
  readonly direct: ReadonlyMap<string, ReadonlySet<string>>;
  readonly inherited: ReadonlyMap<string, ReadonlySet<string>>;
  readonly internalNative: ReadonlyMap<string, ReadonlySet<string>>;
  readonly globalWindow: ReadonlySet<string>;
  readonly rawFailures: ReadonlySet<string>;
  readonly crossZoneFailures: ReadonlySet<string>;
  readonly edges: readonly { readonly file: string; readonly target: string }[];
}

// A module's authority is derived from its actual inputs: its adapter registration, parameters whose types
// grant it, and what its accesses, globals and imports acquire. A type-only import grants none, and authority
// flows to every runtime importer.
export function authorityGraph(
  snapshot: Snapshot,
  context: CapabilityContext,
  parts: readonly AuthorityPart[],
  crossZoneFailures: ReadonlySet<string>,
): AuthorityGraph {
  const projects = snapshot.compiler?.projects ?? [];
  const { natives } = context;
  const direct = new Map(context.files.map((path) => [path, new Set<string>()]));
  const internalNative = new Map(
    context.adapters.filter(({ adapter }) => adapter.kind === "external").map(({ path }) => [path, new Set<string>()]),
  );
  const recordNative = (path: string, capability: string): void => {
    (internalNative.get(path) ?? direct.get(path))?.add(capability);
    if (natives.get(capability)?.windowOnly === true) direct.get(path)?.add(WINDOW_AUTHORITY);
  };
  for (const { adapter, path } of context.adapters) direct.get(path)?.add(adapter.capability);
  for (const parameter of projects.flatMap((project) => project.parameters)) {
    for (const authority of parameter.nativeAuthority ?? []) recordNative(parameter.file, nativeKey(authority.root));
    for (const contract of context.contractTypes)
      if (
        (contract.kind !== "produce" || parameter.callable || parameter.accessor) &&
        parameter.types.some((type) => type.file === contract.type.file && type.name === contract.type.name)
      )
        direct.get(parameter.file)?.add(contract.capability);
  }
  for (const part of parts) {
    for (const { file, key } of part.natives) recordNative(file, key);
    for (const { file, capability } of part.grants) direct.get(file)?.add(capability);
  }
  const edges = projects
    .flatMap((project) => project.imports)
    .flatMap((edge) => (edge.typeOnly || edge.target === null ? [] : [{ file: edge.file, target: edge.target }]));
  const inherited = new Map([...direct].map(([path, capabilities]) => [path, new Set(capabilities)]));
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of edges)
      for (const capability of inherited.get(edge.target) ?? []) {
        const capabilities = inherited.get(edge.file);
        if (capabilities !== undefined && !capabilities.has(capability)) {
          capabilities.add(capability);
          changed = true;
        }
      }
  }
  return {
    direct,
    inherited,
    internalNative,
    globalWindow: new Set(parts.flatMap((part) => part.globalWindow)),
    rawFailures: new Set(parts.flatMap((part) => part.rawFailures)),
    crossZoneFailures,
    edges,
  };
}

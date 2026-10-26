import type { Snapshot } from "../primitives/snapshot.js";
import {
  type CapabilityContext,
  type CapabilityFinding,
  HOST_LIBRARY,
  WINDOW_AUTHORITY,
  capabilityFinding,
  capabilityLimit,
  nativeKey,
  placed,
  zoneOf,
} from "./capability-context.js";
import { cycles } from "./dependency-check.js";

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

// A module's authority is derived from its actual inputs: runtime imports, ambient globals and parameters whose
// types grant it. A type-only import grants none, and what can't be established is a limit, never purity.
export function authorityGraph(
  snapshot: Snapshot,
  context: CapabilityContext,
): { readonly graph: AuthorityGraph; readonly findings: readonly CapabilityFinding[] } {
  const projects = snapshot.compiler?.projects ?? [];
  const { startups, natives } = context;
  const registered = context.adapters.map(({ adapter }) => adapter);
  const externalAdapterPaths = new Set(
    context.adapters.filter(({ adapter }) => adapter.kind === "external").map(({ path }) => path),
  );
  const direct = new Map(context.files.map((path) => [path, new Set<string>()]));
  const internalNative = new Map([...externalAdapterPaths].map((path) => [path, new Set<string>()]));
  const globalWindow = new Set<string>();
  const rawFailures = new Set<string>();
  const crossZoneFailures = new Set<string>();
  const findings: CapabilityFinding[] = [];
  const add = (rule: "R1" | "R2", check: string, path: string, fix: string, detail: string): void => {
    findings.push(capabilityFinding(snapshot, startups, rule, check, path, fix, detail));
  };
  const unresolved = (check: string, path: string, limit: string, detail: string): void => {
    findings.push(capabilityLimit(check, path, limit, detail));
  };
  const recordNative = (path: string, capability: string): void => {
    (internalNative.get(path) ?? direct.get(path))?.add(capability);
    if (natives.get(capability)?.windowOnly === true) direct.get(path)?.add(WINDOW_AUTHORITY);
  };
  for (const { adapter, path } of context.adapters) direct.get(path)?.add(adapter.capability);
  for (const project of projects) {
    for (const parameter of project.parameters) {
      for (const authority of parameter.nativeAuthority ?? []) recordNative(parameter.file, nativeKey(authority.root));
      for (const contract of context.contractTypes)
        if (
          (contract.kind !== "produce" || parameter.callable || parameter.accessor) &&
          parameter.types.some((type) => type.file === contract.type.file && type.name === contract.type.name)
        )
          direct.get(parameter.file)?.add(contract.capability);
    }
    for (const access of project.accesses) {
      if (!direct.has(access.file)) continue;
      if (access.kind === "native") {
        for (const authority of access.nativeAuthority ?? []) recordNative(access.file, nativeKey(authority.root));
        if ((access.nativeAuthority ?? []).length === 0)
          unresolved(
            "native-authority",
            access.file,
            "The native executable member has no supported receiver identity.",
            access.site ?? `${access.start}`,
          );
      } else if (access.kind === "clock" || access.kind === "randomness") {
        const kind = access.kind;
        const owned = context.adapters.some(
          ({ adapter, path }) => adapter.kind === "external" && path === access.file && adapter.primitives?.includes(kind),
        );
        if (!owned) {
          direct.get(access.file)?.add(access.kind);
          rawFailures.add(`${access.file}:${access.kind}`);
          add("R1", "raw-primitive", access.file, "Sample this operation only in its declared capability adapter.", access.kind);
        }
      } else if (access.kind === "dynamic")
        unresolved(
          "authority-entry",
          access.file,
          "Dynamic code or ambient access has no supported authority identity.",
          `${access.kind}:${access.site ?? access.start}`,
        );
    }
    const hostGlobals = new Set<string>();
    for (const global of project.globals) {
      if (!global.runtime || !direct.has(global.file)) continue;
      // An installed package's ambient global, such as Node's process or require, reaches the host without any
      // import, so only an adapter that declares it may use it.
      const name = global.name.startsWith("globalThis.") ? global.name.slice("globalThis.".length) : global.name;
      const declared = global.declarationFile ?? "";
      if (
        !name.includes(".") &&
        global.value !== true &&
        /(?:^|\/)node_modules\//.test(declared) &&
        !/(?:^|\/)node_modules\/typescript\/lib\//.test(declared) &&
        !registered.some((adapter) => adapter.globals?.includes(name)) &&
        !hostGlobals.has(`${global.file}:${name}`)
      ) {
        hostGlobals.add(`${global.file}:${name}`);
        unresolved(
          "ambient-global",
          global.file,
          "This ambient global from an installed package has no declared capability adapter.",
          name,
        );
      }
      const declaredAdapters = context.adapters.filter(({ adapter }) => adapter.globals?.includes(global.name));
      const owners = declaredAdapters.filter(({ path }) => path === global.file);
      if (externalAdapterPaths.has(global.file) || declaredAdapters.length === 0)
        for (const authority of global.nativeAuthority ?? []) {
          recordNative(global.file, nativeKey(authority.root));
          if (HOST_LIBRARY.test(authority.root.file) && authority.root.name === "Window")
            globalWindow.add(`${global.file}:${nativeKey(authority.root)}`);
        }
      for (const { adapter, path } of owners.length > 0 ? owners : declaredAdapters) {
        direct.get(global.file)?.add(adapter.capability);
        if (global.file !== path) {
          rawFailures.add(`${global.file}:${adapter.capability}`);
          add(
            "R1",
            "raw-primitive",
            global.file,
            "Acquire this ambient authority only through its declared capability adapter.",
            adapter.capability,
          );
        }
      }
    }
    for (const edge of project.imports) {
      const from = placed(snapshot, edge.file);
      const to = edge.target === null ? null : placed(snapshot, edge.target);
      if (edge.target !== null && startups.includes(edge.target) && direct.has(edge.file))
        add("R2", "startup-import", edge.file, "Keep executable entrypoints outside the imported module graph.", edge.target);
      if (startups.includes(edge.file) && edge.target !== null && direct.has(edge.target) && zoneOf(snapshot, edge.target) === undefined)
        unresolved("migration-zone", edge.file, "Startup wiring does not establish a zone for its dependencies.", edge.target);
      if (
        from !== null &&
        to !== null &&
        ((from.layer === "adapters" && to.layer !== "primitives") ||
          (from.zone === to.zone
            ? !(from.layer === "compositions" || to.layer === "primitives" || (from.layer === "readings" && to.layer === "readings"))
            : from.zone === "core" || to.zone !== "core"))
      )
        add(
          "R2",
          "layer-edge",
          edge.file,
          "Depend down or sideways within this zone, or inward on a public core contract.",
          edge.target ?? "",
        );
      if (
        edge.target !== null &&
        direct.has(edge.file) &&
        direct.has(edge.target) &&
        !startups.includes(edge.file) &&
        !startups.includes(edge.target) &&
        (from === null) !== (to === null)
      ) {
        const fromZone = zoneOf(snapshot, edge.file);
        const toZone = zoneOf(snapshot, edge.target);
        if (fromZone === undefined || toZone === undefined)
          unresolved(
            "migration-zone",
            edge.file,
            "Declare the legacy prefix's actual zone before establishing this cross-placement boundary.",
            edge.target,
          );
        else if (fromZone !== toZone && (fromZone === "core" || toZone !== "core")) {
          crossZoneFailures.add(`${edge.file}:${edge.target}`);
          add(
            "R2",
            "zone-edge",
            edge.file,
            "Keep cross-placement imports in the same zone or point inward to core; legacy placement grants no outer-zone access.",
            edge.target,
          );
        }
      }
      if (edge.typeOnly || !direct.has(edge.file) || (edge.target !== null && direct.has(edge.target))) continue;
      const packageName = edge.specifier.startsWith("@")
        ? edge.specifier.split("/").slice(0, 2).join("/")
        : edge.specifier.split("/")[0];
      const declaration = snapshot.config.packages?.find((row) => row.name === packageName);
      const bound = context.adapters.filter(
        ({ adapter }) => adapter.kind === "external" && packageName !== undefined && adapter.packages?.includes(packageName) === true,
      );
      const owners = bound.filter(({ path }) => path === edge.file);
      if (bound.length > 0 && !edge.specifier.startsWith(".") && !edge.specifier.startsWith("#")) {
        // An adapter's package is its raw operation: binding it to the adapter's row is what keeps the core and
        // the adapter's neighbours from reaching it, whatever a package row says.
        for (const { adapter } of owners.length > 0 ? owners : bound) {
          direct.get(edge.file)?.add(adapter.capability);
          if (owners.length === 0) rawFailures.add(`${edge.file}:${adapter.capability}`);
        }
        if (owners.length === 0)
          add(
            "R1",
            "package-import",
            edge.file,
            "Import this package only in the capability adapter that declares it, and use that adapter's contract here.",
            packageName ?? edge.specifier,
          );
      } else if (declaration?.entrypointExports !== undefined) {
        const named = edge.namedImports;
        if (
          startups.includes(edge.file) &&
          edge.specifier === declaration.name &&
          named !== undefined &&
          named !== null &&
          named.length > 0 &&
          named.every((name) => declaration.entrypointExports?.includes(name))
        )
          for (const capability of declaration.capabilities) direct.get(edge.file)?.add(capability);
        else
          unresolved(
            "entrypoint-package",
            edge.file,
            "This package contract permits only selected named runtime exports in an exact declared entrypoint.",
            edge.specifier,
          );
      } else if (declaration !== undefined && !edge.specifier.startsWith(".") && !edge.specifier.startsWith("#"))
        for (const capability of declaration.capabilities) direct.get(edge.file)?.add(capability);
      else
        unresolved(
          "external-boundary",
          edge.file,
          "This runtime import has no classified local source or adapter authority.",
          edge.specifier,
        );
    }
  }
  const imports = projects.flatMap((project) => project.imports);
  for (const cycle of cycles(
    imports.flatMap((edge): [string, string][] =>
      edge.target !== null && direct.has(edge.file) && direct.has(edge.target) ? [[edge.file, edge.target]] : [],
    ),
  )) {
    const path = cycle[0];
    if (path !== undefined)
      add("R2", "cycle", path, "Break this layered module import cycle through a shared lower contract.", cycle.join(","));
  }
  const edges = imports.flatMap((edge) =>
    edge.typeOnly || edge.target === null ? [] : [{ file: edge.file, target: edge.target }],
  );
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
    graph: { direct, inherited, internalNative, globalWindow, rawFailures, crossZoneFailures, edges },
    findings,
  };
}

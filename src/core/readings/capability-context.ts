import type { CompilerFacts } from "../primitives/compiler-facts.js";
import type { KitConfig } from "../primitives/default-config.js";
import { LAYERS } from "../primitives/layer.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, finding } from "./finding.js";
import { type Placed, legacyCodeOf, moduleFileOf, placementOf, rootOf } from "./placement-of.js";

export interface CapabilityFinding extends Finding {
  readonly status: "violation" | "unresolved" | "review-held";
  readonly blocking: boolean;
  readonly limit: string;
  readonly category: "legacy-debt" | "checker-limit" | "placed-violation";
}

type Project = CompilerFacts["projects"][number];
export type Adapter = NonNullable<KitConfig["adapters"]>[number];
export type NativeAuthority = NonNullable<Project["globals"][number]["nativeAuthority"]>[number];
type Zone = "core" | "shell" | "substrate";

// What every capability check reads: the checked files, the declared entrypoints, each registered adapter's
// file and contract facts, the contract and port types that carry a capability, and the native roots seen.
export interface CapabilityContext {
  readonly files: readonly string[];
  readonly startups: readonly string[];
  readonly adapters: readonly {
    readonly adapter: Adapter;
    readonly path: string;
    readonly contracts: readonly Project["contracts"][number][];
  }[];
  readonly contractTypes: readonly {
    readonly capability: string;
    readonly type: { readonly file: string; readonly name: string };
    readonly kind: Adapter["kind"];
  }[];
  readonly natives: ReadonlyMap<string, NativeAuthority>;
}

export const WINDOW_AUTHORITY = "host:window";
export const HOST_LIBRARY = /(?:^|\/)lib\.dom(?:\.[\w-]+)*\.d\.ts$/;

export const nativeKey = (identity: { readonly file: string; readonly name: string }): string =>
  `native:${identity.file}:${identity.name}`;

export function placed(snapshot: Snapshot, path: string): Placed | null {
  const at = placementOf(path, snapshot.config.srcRoot, snapshot.config.layerNames);
  return at.placed ? at : null;
}

export const adapterPath = (snapshot: Snapshot, module: string): string =>
  moduleFileOf(module, snapshot.config.srcRoot, snapshot.config.layerNames);

// A placed file's zone, or the zone a legacy zone row declares for a legacy one.
export function zoneOf(snapshot: Snapshot, path: string): Zone | undefined {
  const roots = snapshot.config.srcRoot;
  const root = rootOf(path, roots);
  if (root === undefined && !legacyCodeOf(path, snapshot.config.layout?.legacy)) return undefined;
  const zone = root === undefined ? undefined : path.slice(root.length + 1).split("/")[0];
  if (zone === "core" || zone === "shell" || zone === "substrate") return zone;
  return snapshot.config.legacyZones?.find((row) =>
    "files" in row
      ? row.files.includes(path) && placed(snapshot, path) === null
      : path.startsWith(`${row.root.replace(/\/$/, "")}/`),
  )?.zone;
}

// A violation in placed code or a declared entrypoint can't be waived; one in legacy code is debt. What the
// checker can't establish is a limit.
export function capabilityFinding(
  snapshot: Snapshot,
  startups: readonly string[],
  rule: "R1" | "R2",
  check: string,
  path: string,
  fix: string,
  detail?: string,
): CapabilityFinding {
  return {
    ...finding(rule, check, path, fix, detail),
    status: "violation",
    blocking: true,
    limit: "",
    category: placed(snapshot, path) === null && !startups.includes(path) ? "legacy-debt" : "placed-violation",
  };
}

export function capabilityLimit(check: string, path: string, limit: string, detail?: string): CapabilityFinding {
  return {
    ...finding(
      "R1",
      check,
      path,
      "Establish this boundary through a supported adapter or retain its explicit uncertainty.",
      detail,
    ),
    status: "unresolved",
    blocking: true,
    limit,
    category: "checker-limit",
  };
}

// Placement needs one distinct directory per layer; otherwise nothing can be placed and the check stops here.
export function layerConfigLimit(snapshot: Snapshot): CapabilityFinding | undefined {
  const roots = snapshot.config.srcRoot;
  const directories = LAYERS.map(
    (layer) => Object.entries(snapshot.config.layerNames ?? {}).find(([name]) => name === layer)?.[1] ?? layer,
  );
  if (new Set(directories).size === LAYERS.length && directories.every((name) => /^[a-z][a-z0-9-]*$/.test(name)))
    return undefined;
  return {
    ...finding(
      "R1",
      "layer-config",
      typeof roots === "string" ? roots : roots.join(","),
      "Declare one distinct directory name for each of the four layers.",
    ),
    status: "unresolved",
    blocking: true,
    limit: "Ambiguous or non-directory names cannot establish module placement.",
    category: "checker-limit",
  };
}

// The checked files: sources, and test files declared as entrypoints, in a code root or a legacy location.
export function checkedFiles(snapshot: Snapshot): string[] {
  const roots = snapshot.config.srcRoot;
  return snapshot.files
    .filter(
      (file) =>
        (file.type === "source" || (file.type === "test" && snapshot.config.exceptions?.includes(file.path))) &&
        (rootOf(file.path, roots) !== undefined || legacyCodeOf(file.path, snapshot.config.layout?.legacy)),
    )
    .map((file) => file.path);
}

export function capabilityContext(snapshot: Snapshot, startups: readonly string[]): CapabilityContext {
  rootOf("", snapshot.config.srcRoot);
  const files = checkedFiles(snapshot);
  const projects = snapshot.compiler?.projects ?? [];
  const adapters = (snapshot.config.adapters ?? []).map((adapter) => {
    const path = adapterPath(snapshot, adapter.module);
    const contract = adapter.contract;
    return {
      adapter,
      path,
      contracts:
        contract === undefined
          ? []
          : projects
              .flatMap((project) => project.contracts)
              .filter((fact) => fact.file === path && fact.name === contract.type),
    };
  });
  const contractTypes = adapters.flatMap(({ adapter, contracts }) =>
    contracts.flatMap((fact) =>
      fact.type === null
        ? []
        : [
            { capability: adapter.capability, type: fact.type, kind: adapter.kind },
            // A port the contract returns carries the same capability, and no other.
            ...(adapter.kind === "external" ? (fact.ports ?? []) : []).map((port) => ({
              capability: adapter.capability,
              type: port,
              kind: adapter.kind,
            })),
          ],
    ),
  );
  const natives = new Map(
    projects.flatMap((project) =>
      [...project.parameters, ...project.accesses, ...project.globals].flatMap((entry) =>
        (entry.nativeAuthority ?? []).map((authority) => [nativeKey(authority.root), authority] as const),
      ),
    ),
  );
  return { files, startups, adapters, contractTypes, natives };
}

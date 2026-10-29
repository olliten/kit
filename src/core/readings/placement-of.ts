import { LAYERS, type Layer } from "../primitives/layer.js";
import { ZONES, type Zone } from "../primitives/zones.js";

export interface Placed {
  readonly placed: true;
  readonly zone: Zone;
  readonly layer: Layer;
  // The file name up to its first dot: `total.ts` and `total.sums.test.ts` both name `total`.
  readonly name: string;
  // What follows the name, without the leading dot: `ts`, `law.test.ts`.
  readonly rest: string;
  // Single-root callers keep their debt keys; explicit root sets distinguish module homes.
  readonly artifact: string;
}

export interface Legacy {
  readonly placed: false;
}

const LEGACY: Legacy = { placed: false };

const isZone = (s: string): s is Zone => ZONES.some((zone) => zone === s);

// A claim proof: a test at `<oracle>/<topic>/<anchor>.test.ts`, optionally with variants before `.test.ts`.
export function proofOf(
  path: string,
  root: string,
): { readonly topic: string; readonly anchor: string } | null {
  if (!path.startsWith(`${root}/`)) return null;
  const match = /^([\w-]+)\/([\w-]+)(?:\.[\w-]+)*\.test\.ts$/.exec(path.slice(root.length + 1));
  return match?.[1] === undefined || match[2] === undefined
    ? null
    : { topic: match[1], anchor: match[2] };
}

// An executable entrypoint: every claim proof, and each file the app declares as one.
export function entrypointOf(path: string, declared: readonly string[], oracleRoot: string): boolean {
  return declared.includes(path) || proofOf(path, oracleRoot) !== null;
}

export function legacyCodeOf(path: string, locations: readonly string[] = []): boolean {
  for (const location of locations) rootOf("", [location]);
  return locations.some((location) => path === location || path.startsWith(`${location}/`));
}

export function moduleFileOf(
  module: string,
  roots: string | readonly string[],
  layerNames?: Readonly<Partial<Record<Layer, string>>>,
): string {
  const root = typeof roots === "string" ? roots : rootOf(module, roots);
  if (root === undefined)
    throw new Error("Qualify the module identity with one of the declared code roots.");
  const relative = typeof roots === "string" ? module : module.slice(root.length + 1);
  const [zone, layer = "", name, ...deeper] = relative.split("/");
  if (
    typeof roots !== "string" &&
    (!zone || !layer || !name || deeper.length > 0)
  )
    throw new Error("Declare a canonical module identity under one of the code roots.");
  const physical = Object.entries(layerNames ?? {}).find(([logical]) => logical === layer)?.[1] ?? layer;
  // A JavaScript module names its extension; TypeScript is the default.
  const file = /\.[cm]?js$/.test(name ?? "") ? (name ?? "") : `${name ?? ""}.ts`;
  return `${root}/${zone ?? ""}/${physical}/${file}`;
}

export function rootOf(
  path: string,
  roots: string | readonly string[],
): string | undefined {
  if (
    typeof roots !== "string" &&
    (roots.length === 0 ||
      Array.from(roots).some(
        (root, index) =>
          typeof root !== "string" ||
          root.trim() !== root ||
          /[\\*?{}[\]]/.test(root) ||
          /^[a-z]:/i.test(root) ||
          root.split("/").some((part) => part === "" || part === "." || part === "..") ||
          roots.some(
            (other, otherIndex) =>
              index !== otherIndex && (root === other || root.startsWith(`${other}/`)),
          ),
      ))
  )
    throw new Error("Declare nonempty, distinct, non-overlapping relative code roots.");
  const root =
    typeof roots === "string"
      ? roots
      : roots.find((candidate) => path.startsWith(`${candidate}/`));
  return root !== undefined && path.startsWith(`${root}/`) ? root : undefined;
}

export function placementOf(
  path: string,
  roots: string | readonly string[],
  layerNames?: Readonly<Partial<Record<Layer, string>>>,
): Placed | Legacy {
  const root = rootOf(path, roots);
  if (root === undefined) return LEGACY;
  const prefix = `${root}/`;
  const [zone, physical, file, ...deeper] = path.slice(prefix.length).split("/");
  if (zone === undefined || !isZone(zone) || file === undefined || deeper.length > 0) {
    return LEGACY;
  }
  const directories = Object.entries(layerNames ?? {});
  const layer = LAYERS.find(
    (name) => (directories.find(([role]) => role === name)?.[1] ?? name) === physical,
  );
  if (layer === undefined) return LEGACY;
  const dot = file.indexOf(".");
  if (dot <= 0 || file.endsWith(".")) return LEGACY;
  const name = file.slice(0, dot);
  return {
    placed: true,
    zone,
    layer,
    name,
    rest: file.slice(dot + 1),
    artifact: `${typeof roots === "string" ? "" : `${root}/`}${zone}/${layer}/${name}`,
  };
}

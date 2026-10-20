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

export function placementOf(
  path: string,
  roots: string | readonly string[],
  layerNames?: Readonly<Partial<Record<Layer, string>>>,
): Placed | Legacy {
  if (
    typeof roots !== "string" &&
    (roots.length === 0 ||
      roots.some(
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
  if (root === undefined) return LEGACY;
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) return LEGACY;
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

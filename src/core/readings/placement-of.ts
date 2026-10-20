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
  // `<zone>/<layer>/<name>`: the artifact's name in spec and code.
  readonly artifact: string;
}

export interface Legacy {
  readonly placed: false;
}

const LEGACY: Legacy = { placed: false };

const isZone = (s: string): s is Zone => ZONES.some((zone) => zone === s);

export interface ModulePath {
  readonly zone: Zone;
  readonly layer: Layer;
  readonly file: string;
}

export function modulePathOf(
  path: string,
  root: string,
  layerNames?: Readonly<Partial<Record<Layer, string>>>,
): ModulePath | null {
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) return null;
  const [zone, physical, file, ...deeper] = path.slice(prefix.length).split("/");
  if (zone === undefined || !isZone(zone) || file === undefined || deeper.length > 0) {
    return null;
  }
  const directories = Object.entries(layerNames ?? {});
  const layer = LAYERS.find(
    (name) => (directories.find(([role]) => role === name)?.[1] ?? name) === physical,
  );
  return layer === undefined ? null : { zone, layer, file };
}

export function placementOf(path: string, root: string): Placed | Legacy {
  const at = modulePathOf(path, root);
  if (at === null) return LEGACY;
  const { zone, layer, file } = at;
  const dot = file.indexOf(".");
  if (dot <= 0) return LEGACY;
  const name = file.slice(0, dot);
  return {
    placed: true,
    zone,
    layer,
    name,
    rest: file.slice(dot + 1),
    artifact: `${zone}/${layer}/${name}`,
  };
}

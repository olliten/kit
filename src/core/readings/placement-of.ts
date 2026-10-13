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
const isLayer = (s: string): s is Layer => LAYERS.some((layer) => layer === s);

export function placementOf(path: string, root: string): Placed | Legacy {
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) return LEGACY;
  const [zone, layer, file, ...deeper] = path.slice(prefix.length).split("/");
  if (zone === undefined || layer === undefined || file === undefined || deeper.length > 0) {
    return LEGACY;
  }
  if (!isZone(zone) || !isLayer(layer)) return LEGACY;
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

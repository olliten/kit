import { KINDS, type Kind } from "../data/kinds.js";
import { ZONES, type Zone } from "../data/zones.js";

export interface Placed {
  readonly placed: true;
  readonly zone: Zone;
  readonly kind: Kind;
  // The file name up to its first dot: `total.ts` and `total.sums.test.ts` both name `total`.
  readonly name: string;
  // What follows the name, without the leading dot: `ts`, `law.test.ts`.
  readonly rest: string;
  // `<zone>/<kind>/<name>`: the artifact's name in spec, code and oracle alike.
  readonly artifact: string;
}

export interface Legacy {
  readonly placed: false;
}

const LEGACY: Legacy = { placed: false };

const isZone = (s: string): s is Zone => (ZONES as readonly string[]).includes(s);
const isKind = (s: string): s is Kind => (KINDS as readonly string[]).includes(s);

// An artifact's zone and kind from its path `<root>/<zone>/<kind>/<name>.<rest>`; anything else is legacy.
export function kindOf(path: string, root: string): Placed | Legacy {
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) return LEGACY;
  const [zone, kind, file, ...deeper] = path.slice(prefix.length).split("/");
  if (zone === undefined || kind === undefined || file === undefined || deeper.length > 0) {
    return LEGACY;
  }
  if (!isZone(zone) || !isKind(kind)) return LEGACY;
  const dot = file.indexOf(".");
  if (dot <= 0) return LEGACY;
  const name = file.slice(0, dot);
  return {
    placed: true,
    zone,
    kind,
    name,
    rest: file.slice(dot + 1),
    artifact: `${zone}/${kind}/${name}`,
  };
}

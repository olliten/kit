import type { KitConfig } from "../primitives/default-config.js";
import { isRecord, isText, isTexts, isZone } from "./config-values.js";

// The zones legacy code is declared in: a root row zones every file under it, a files row exactly those files.
export function legacyZones(declared: unknown): NonNullable<KitConfig["legacyZones"]> {
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new Error("The Kit configuration's legacy-zones must list rows.");
  return declared.map((row: unknown, index) => {
    const zone = isRecord(row) ? row["zone"] : undefined;
    const root = isRecord(row) ? row["root"] : undefined;
    const files = isRecord(row) ? row["files"] : undefined;
    if (isZone(zone) && isText(root) && files === undefined) return { root, zone };
    if (isZone(zone) && isTexts(files) && root === undefined) return { files, zone };
    throw new Error(`legacy-zones[${index}]: a legacy zone row declares a zone and either a root or a list of files.`);
  });
}

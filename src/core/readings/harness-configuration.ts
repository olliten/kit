import type { Harness } from "../primitives/default-config.js";
import { isRecord, isText, normalizedPath, relativeLocation } from "./config-values.js";

const shape = "declare each harness as under, a relative directory ending in /, and the reason it is one";

// The directories of shared test code an app declares as harnesses. A harness takes the reach of every test that
// goes through it, so it is declared, with its reason, never inferred; which keys a row may hold, the schema of
// the config already holds.
export function configuredHarnesses(declared: unknown): Harness[] {
  if (!Array.isArray(declared)) throw new Error(`harnesses: list the harness rows; ${shape}.`);
  const seen = new Map<string, number>();
  return declared.map((row: unknown, index) => {
    const at = `harnesses[${index}]`;
    if (!isRecord(row)) throw new Error(`${at}: a harness row is a mapping; ${shape}.`);
    const { under, reason } = row;
    if (
      !isText(under) ||
      !under.endsWith("/") ||
      under.trim() !== under ||
      !relativeLocation(under) ||
      under.split("/").slice(0, -1).some((part) => part === "" || part === "." || part === "..")
    )
      throw new Error(`${at}.under: name the harness as a relative directory ending in /, such as spec/harness/.`);
    if (!isText(reason) || !reason.trim()) throw new Error(`${at}.reason: declare why the directory is a harness, as nonempty text.`);
    const directory = `${normalizedPath(under)}/`;
    const earlier = seen.get(directory);
    if (earlier !== undefined) throw new Error(`${at}.under: repeats harnesses[${earlier}], which already declares ${directory}.`);
    seen.set(directory, index);
    return { under: directory, reason };
  });
}

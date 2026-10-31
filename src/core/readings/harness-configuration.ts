import type { Harness } from "../primitives/default-config.js";
import { isRecord, isText, normalizedPath, relativeLocation } from "./config-values.js";

const shape = "declare each harness as under, a relative directory ending in /, or file, a relative file, and the reason it is one";

// A relative path without patterns, empty, `.` or `..` parts.
const plain = (path: string): boolean =>
  path.trim() === path && relativeLocation(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

// The directories and files of shared test code an app declares as harnesses. A harness takes the reach of every
// test that goes through it, so it is declared, with its reason, never inferred; which keys a row may hold, the
// schema of the config already holds. That a declared file exists is for the reader of the app to check.
export function configuredHarnesses(declared: unknown): Harness[] {
  if (!Array.isArray(declared)) throw new Error(`harnesses: list the harness rows; ${shape}.`);
  const seen = new Map<string, number>();
  return declared.map((row: unknown, index) => {
    const at = `harnesses[${index}]`;
    if (!isRecord(row)) throw new Error(`${at}: a harness row is a mapping; ${shape}.`);
    const { under, file, reason } = row;
    if ((under === undefined) === (file === undefined)) throw new Error(`${at}: name under or file, not ${under === undefined ? "neither" : "both"}.`);
    if (under !== undefined && !(isText(under) && under.endsWith("/") && plain(under.slice(0, -1))))
      throw new Error(`${at}.under: name the harness as a relative directory ending in /, such as spec/harness/.`);
    if (file !== undefined && !(isText(file) && !file.endsWith("/") && plain(file)))
      throw new Error(`${at}.file: name the harness as a relative file, such as oracle/commands/command-bar.harness.ts.`);
    if (!isText(reason) || !reason.trim()) throw new Error(`${at}.reason: declare why it is a harness, as nonempty text.`);
    const subject = isText(under) ? `${normalizedPath(under)}/` : normalizedPath(String(file));
    const earlier = seen.get(subject);
    if (earlier !== undefined) throw new Error(`${at}: repeats harnesses[${earlier}], which already declares ${subject}.`);
    seen.set(subject, index);
    return isText(under) ? { under: subject, reason } : { file: subject, reason };
  });
}

// The declared harness files the app doesn't hold, given those of them it does, each as the error naming its row.
export function missingHarnesses(harnesses: readonly Harness[], held: ReadonlySet<string>): string[] {
  return harnesses.flatMap((harness, index) =>
    "file" in harness && !held.has(harness.file) ? [`harnesses[${index}].file: ${harness.file} is not a file in the app.`] : [],
  );
}

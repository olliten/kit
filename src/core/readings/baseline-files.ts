// A baseline kept as a directory holds one file per finding path: the debt keys of findings on that path and
// any size each records. Agents paying down debt on different modules then edit different files.
export const baselineFileOf = (directory: string, path: string): string => `${directory}/${path.replaceAll("/", "+")}.json`;

// The path a debt key's finding is on: the third field of `rule:check:path[:detail]`.
const pathOf = (key: string): string => key.split(":")[2] ?? key;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The baseline the ratchet reads: every file's keys together. A file that isn't a record of debt keys is an
// error, never an empty baseline, since that would fail every finding it held for the wrong reason.
export function mergedBaseline(files: readonly { readonly path: string; readonly text: string }[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const { path, text } of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${path}: a baseline file is a record of debt keys.`);
    }
    if (!isRecord(parsed)) throw new Error(`${path}: a baseline file is a record of debt keys.`);
    for (const [key, entry] of Object.entries(parsed)) {
      // A reason is for a reader, so one that says nothing is refused rather than shown blank.
      const reason: unknown = isRecord(entry) && Object.hasOwn(entry, "reason") ? entry["reason"] : undefined;
      if (reason !== undefined && (typeof reason !== "string" || reason.trim() === ""))
        throw new Error(`${path}: the reason of ${key} is a nonempty string.`);
      merged[key] = entry;
    }
  }
  return merged;
}

// The files a baseline record is kept as in a directory, by file path, each holding one finding path's keys.
export function baselineFiles(directory: string, record: Readonly<Record<string, unknown>>): Map<string, string> {
  const groups = new Map<string, Record<string, unknown>>();
  for (const key of Object.keys(record).sort()) {
    const file = baselineFileOf(directory, pathOf(key));
    const group = groups.get(file) ?? {};
    group[key] = record[key];
    groups.set(file, group);
  }
  return new Map([...groups].map(([file, group]) => [file, `${JSON.stringify(group, null, 2)}\n`]));
}

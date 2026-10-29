import { createHash } from "node:crypto";

export const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

// What every fact of one compiler project depends on besides the files a fact's own file imports: the Kit that
// reads it, the compiler, the config, the project's options, every declaration file the program loads, every
// file that declares globals or ambient modules, and the adapter modules whose exports name the registered
// contracts. A file that uses a contract imports it, so what the contract's own module imports is in that file's
// closure already; holding the adapters' closures here would make most edits re-read the whole project.
export interface ProjectInputs {
  readonly engine: string;
  readonly typescript: string;
  readonly config: unknown;
  readonly options: string;
  readonly declarations: readonly (readonly [string, string])[];
  readonly globals: readonly (readonly [string, string])[];
  readonly adapters: readonly (readonly [string, string])[];
}

const KEY_VERSION = 1;

export function projectKey(inputs: ProjectInputs): string {
  const sorted = (entries: readonly (readonly [string, string])[]) =>
    [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return digest(
    JSON.stringify({
      version: KEY_VERSION,
      engine: inputs.engine,
      typescript: inputs.typescript,
      config: inputs.config,
      options: inputs.options,
      declarations: sorted(inputs.declarations),
      globals: sorted(inputs.globals),
      adapters: sorted(inputs.adapters),
    }),
  );
}

// Each file and every file its imports reach, transitively. A fact about a file depends only on these and on
// its project, so a change recomputes exactly the files whose closure holds it.
export function importClosures(files: readonly string[], edges: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const closures = new Map<string, string[]>();
  for (const file of files) {
    const seen = new Set([file]);
    const pending = [file];
    for (let next = pending.pop(); next !== undefined; next = pending.pop())
      for (const target of edges.get(next) ?? [])
        if (!seen.has(target)) {
          seen.add(target);
          pending.push(target);
        }
    closures.set(file, [...seen].sort());
  }
  return closures;
}

// The key of one file's facts: its project's key, its own content, and the outline of every other file its
// imports reach, since what another file lends a fact is its declarations, not the bodies of functions whose
// return type it declares. A test's reach keys on its test the same way, and names the files whose code it followed besides.
export function factsKey(
  project: string,
  file: string,
  closure: readonly string[],
  digests: ReadonlyMap<string, string>,
  outlines: ReadonlyMap<string, string>,
  roles: ReadonlyMap<string, string>,
): string {
  return digest(
    JSON.stringify([
      project,
      [file, digests.get(file) ?? null, roles.get(file) ?? null],
      closure.filter((path) => path !== file).map((path) => [path, outlines.get(path) ?? digests.get(path) ?? null, roles.get(path) ?? null]),
    ]),
  );
}

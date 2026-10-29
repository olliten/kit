import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";

// One read as extraction made it: what was asked and what came back, file text as its digest.
export interface FilesystemRead {
  readonly operation: "readText" | "entries";
  readonly arguments: readonly [string];
  readonly result: string | readonly (readonly [string, string])[];
}

export interface Filesystem {
  readText(path: string, trace: FilesystemRead[]): string;
  entries(
    path: string,
    trace: FilesystemRead[],
  ): readonly {
    readonly name: string;
    readonly directory: boolean;
    readonly file: boolean;
  }[];
  // What a path holds now: nothing, a file's content as its digest, or a directory's listing as its digest, so
  // a check that read, listed or only probed the path depends on exactly that.
  state(path: string): string;
  // Only whether a path is absent, a file or a directory, for a check that only probed it.
  kind(path: string): string;
  // When a path's content or listing last changed, in the file system's own clock, or none when it is absent.
  modified(path: string): number | undefined;
}

function readText(path: string, trace: FilesystemRead[]): string {
  const bytes = readFileSync(path);
  trace.push({
    operation: "readText",
    arguments: [path],
    result: createHash("sha256").update(bytes).digest("hex"),
  });
  return bytes.toString("utf8");
}

// A symbolic link is neither a file nor a directory to the walk, so its listing kind is other.
function entries(path: string, trace: FilesystemRead[]) {
  const listed = readdirSync(path, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    directory: entry.isDirectory(),
    file: entry.isFile(),
  }));
  trace.push({
    operation: "entries",
    arguments: [path],
    result: listed
      .map((entry): readonly [string, string] => [
        entry.name,
        entry.directory ? "directory" : entry.file ? "file" : "other",
      ])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  });
  return listed;
}

function state(path: string): string {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return "absent";
  }
  if (stat.isDirectory())
    return `directory:${createHash("sha256")
      .update(JSON.stringify(readdirSync(path, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory()]).sort()))
      .digest("hex")}`;
  return `file:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function kind(path: string): string {
  try {
    return statSync(path).isDirectory() ? "directory" : "file";
  } catch {
    return "absent";
  }
}

function modified(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

export const filesystem: Filesystem = {
  readText,
  entries,
  state,
  kind,
  modified,
};

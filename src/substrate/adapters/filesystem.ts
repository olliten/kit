import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

// One read as a cache replays it: what was asked and what came back, file text as its digest. A read that
// threw keeps its error code, so a file that appears later is a change.
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

export const filesystem: Filesystem = {
  readText,
  entries,
};

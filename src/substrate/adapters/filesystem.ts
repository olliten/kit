import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

// One read as a cache replays it: what was asked and what came back, file text as its digest. A read that
// threw keeps its error code, so a file that appears later is a change.
export interface FilesystemRead {
  readonly operation: "readText" | "entries";
  readonly arguments: readonly [string];
  readonly result: string | readonly (readonly [string, string])[] | { readonly error: string };
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
  reread(read: FilesystemRead): FilesystemRead;
}

function readText(path: string, trace: FilesystemRead[]): string {
  try {
    const bytes = readFileSync(path);
    trace.push({
      operation: "readText",
      arguments: [path],
      result: createHash("sha256").update(bytes).digest("hex"),
    });
    return bytes.toString("utf8");
  } catch (error) {
    trace.push({ operation: "readText", arguments: [path], result: { error: codeOf(error) } });
    throw error;
  }
}

// A symbolic link is neither a file nor a directory to the walk, so its listing kind is other.
function entries(path: string, trace: FilesystemRead[]) {
  try {
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
  } catch (error) {
    trace.push({ operation: "entries", arguments: [path], result: { error: codeOf(error) } });
    throw error;
  }
}

function codeOf(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "unknown";
}

export const filesystem: Filesystem = {
  readText,
  entries,
  reread: (read) => {
    const again: FilesystemRead[] = [];
    try {
      if (read.operation === "readText") readText(read.arguments[0], again);
      else entries(read.arguments[0], again);
    } catch {
      // A thrown read is recorded with its error code, which is what gets compared.
    }
    return again[0] ?? read;
  },
};

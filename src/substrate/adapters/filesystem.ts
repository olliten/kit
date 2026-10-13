import { readFileSync, readdirSync } from "node:fs";

export interface Filesystem {
  readText(path: string): string;
  entries(path: string): readonly {
    readonly name: string;
    readonly directory: boolean;
    readonly file: boolean;
  }[];
}

export const filesystem: Filesystem = {
  readText: (path) => readFileSync(path, "utf8"),
  entries: (path) =>
    readdirSync(path, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      directory: entry.isDirectory(),
      file: entry.isFile(),
    })),
};

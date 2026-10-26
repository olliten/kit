import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

// Plain text files a launcher reads and writes outside a snapshot: configs, baselines, spec listings and the
// directories a command fills for itself.
export interface TextFiles {
  read(path: string): string;
  write(path: string, text: string): void;
  exists(path: string): boolean;
  entries(path: string): readonly { readonly name: string; readonly directory: boolean; readonly file: boolean }[];
  directory(path: string): void;
  remove(path: string): void;
}

export const textFiles: TextFiles = {
  read: (path) => readFileSync(path, "utf8"),
  write(path, text) {
    writeFileSync(path, text);
  },
  exists: (path) => existsSync(path),
  entries: (path) =>
    readdirSync(path, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      directory: entry.isDirectory(),
      file: entry.isFile(),
    })),
  directory(path) {
    mkdirSync(path, { recursive: true });
  },
  remove(path) {
    rmSync(path, { recursive: true, force: true });
  },
};

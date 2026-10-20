import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export interface TemporaryProject {
  readonly root: string;
  write(files: Readonly<Record<string, string>>): void;
  dispose(): void;
}

export interface TemporaryProjects {
  open(prefix: string): TemporaryProject;
}

export const temporaryProjects: TemporaryProjects = {
  open(prefix) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    return {
      root,
      write(files) {
        for (const [path, text] of Object.entries(files)) {
          const destination = resolve(root, path);
          if (isAbsolute(path) || !destination.startsWith(`${root}${sep}`))
            throw new Error("Write fixture files by a relative path inside the temporary project.");
          mkdirSync(dirname(destination), { recursive: true });
          writeFileSync(destination, text);
        }
      },
      dispose() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  },
};

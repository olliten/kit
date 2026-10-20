import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
          mkdirSync(dirname(join(root, path)), { recursive: true });
          writeFileSync(join(root, path), text);
        }
      },
      dispose() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  },
};

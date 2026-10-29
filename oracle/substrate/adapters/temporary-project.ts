import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export interface TemporaryProject {
  readonly root: string;
  write(files: Readonly<Record<string, string | Uint8Array>>): void;
  directory(relative: string): void;
  remove(relative: string): void;
  symlink(targetRelative: string, pathRelative: string): void;
  // A link inside the project to a directory outside it, such as installed packages it runs.
  link(targetAbsolute: string, pathRelative: string): void;
  dispose(): void;
}

export interface TemporaryProjects {
  open(prefix: string): TemporaryProject;
}

export const temporaryProjects: TemporaryProjects = {
  open(prefix) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    const inside = (path: string): string => {
      const destination = resolve(root, path);
      if (isAbsolute(path) || !destination.startsWith(`${root}${sep}`))
        throw new Error("Use a relative path inside the temporary project.");
      return destination;
    };
    return {
      root,
      write(files) {
        const entries = Object.entries(files).map(([path, content]) => [inside(path), content] as const);
        for (const [destination, content] of entries) {
          mkdirSync(dirname(destination), { recursive: true });
          writeFileSync(destination, content);
        }
      },
      directory(relative) {
        mkdirSync(inside(relative), { recursive: true });
      },
      remove(relative) {
        rmSync(inside(relative), { recursive: true, force: true });
      },
      symlink(targetRelative, pathRelative) {
        const target = inside(targetRelative);
        const destination = inside(pathRelative);
        mkdirSync(dirname(destination), { recursive: true });
        symlinkSync(target, destination);
      },
      link(targetAbsolute, pathRelative) {
        if (!isAbsolute(targetAbsolute)) throw new Error("Link to an absolute path outside the temporary project.");
        const destination = inside(pathRelative);
        mkdirSync(dirname(destination), { recursive: true });
        symlinkSync(targetAbsolute, destination);
      },
      dispose() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  },
};

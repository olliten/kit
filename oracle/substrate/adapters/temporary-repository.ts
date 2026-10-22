import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface TemporaryRepository {
  readonly root: string;
  commit(files: Readonly<Record<string, string | null>>, message: string): void;
  branch(name: string): void;
  switch(name: string): void;
  dispose(): void;
}

export interface TemporaryRepositories {
  open(prefix: string): TemporaryRepository;
}

// A file given null is deleted. Commits carry a fixed author, so a proof never depends on the machine's git setup.
export const temporaryRepositories: TemporaryRepositories = {
  open(prefix) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    const git = (...args: string[]): void => {
      execFileSync("git", ["-c", "user.name=Kit", "-c", "user.email=kit@example.invalid", ...args], {
        cwd: root,
        stdio: "ignore",
      });
    };
    git("init", "--quiet", "--initial-branch=main");
    return {
      root,
      commit(files, message) {
        for (const [path, content] of Object.entries(files)) {
          const destination = join(root, path);
          if (content === null) rmSync(destination, { force: true });
          else {
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, content);
          }
        }
        git("add", "--all");
        git("commit", "--quiet", "--allow-empty", "-m", message);
      },
      branch(name) {
        git("checkout", "--quiet", "-b", name);
      },
      switch(name) {
        git("checkout", "--quiet", name);
      },
      dispose() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  },
};

import { execFileSync } from "node:child_process";
import type { ChangeHistory, ChangedFile } from "../../core/primitives/change-history.js";

export interface ChangeLog {
  since(root: string, base: string): ChangeHistory;
}

const STATUS: Readonly<Record<string, ChangedFile["status"]>> = { A: "added", M: "modified", D: "deleted" };

// The base is where this branch left the given ref, so the ref moving on cannot make this change look as if it
// undid what landed there. A rename or copy counts as the new path added.
export const changeLog: ChangeLog = {
  since(root, base) {
    const git = (...args: string[]): string =>
      execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const from = git("merge-base", base, "HEAD").trim();
    const parts = git("diff", "--name-status", "-z", `${from}...HEAD`).split("\0").filter(Boolean);
    const files: ChangedFile[] = [];
    for (let index = 0; index < parts.length; ) {
      const letter = parts[index]?.[0] ?? "";
      const renamed = letter === "R" || letter === "C";
      const path = parts[index + (renamed ? 2 : 1)] ?? "";
      files.push({ status: renamed ? "added" : (STATUS[letter] ?? "modified"), path });
      index += renamed ? 3 : 2;
    }
    const messages = git("log", "--format=%B%x00", `${from}..HEAD`)
      .split("\0")
      .map((message) => message.trim())
      .filter(Boolean);
    return { files, messages };
  },
};

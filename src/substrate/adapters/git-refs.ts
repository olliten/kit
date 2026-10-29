import { spawnSync } from "node:child_process";

// One ref of a repository's `origin` as a store shared by every clone, through git alone: a read fetches the tip,
// and an advance pushes a commit on the tip it expects without force, so the remote takes it only while the tip
// is still that one. Any failure other than a moved tip throws, with what git said.
export interface GitRefs {
  // The ref's tip, fetched, and each file of its tree with its blob; null when origin has no such ref.
  read(root: string, ref: string): { readonly tip: string; readonly files: readonly { readonly path: string; readonly blob: string }[] } | null;
  // Each blob's text, in the order asked.
  texts(root: string, blobs: readonly string[]): string[];
  // A commit whose tree is `expected`'s (empty when null) with `files` added, pushed to the ref: the new tip, or
  // null when the ref had moved from `expected`.
  advance(
    root: string,
    ref: string,
    expected: string | null,
    files: readonly { readonly path: string; readonly text: string }[],
    message: string,
  ): string | null;
}

// A credential prompt would hang a gate that has no one to answer it.
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function git(root: string, args: readonly string[], input?: string | Buffer): { stdout: Buffer; stderr: string; status: number | null } {
  const result = spawnSync("git", ["-C", root, ...args], { env: ENV, maxBuffer: 1024 ** 3, ...(input === undefined ? {} : { input }) });
  return { stdout: result.stdout ?? Buffer.alloc(0), stderr: `${result.stderr?.toString("utf8") ?? ""}${result.error?.message ?? ""}`, status: result.status };
}

// What git said, on one line.
const said = (stderr: string): string =>
  stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("; ");

function output(root: string, args: readonly string[], input?: string | Buffer): string {
  const result = git(root, args, input);
  if (result.status !== 0) throw new Error(`git ${args[0]}: ${said(result.stderr)}`);
  return result.stdout.toString("utf8");
}

// A push the remote refused because the ref is no longer the expected tip: locally a non-fast-forward, and on a
// hosted remote also a lost lock on the ref. A refusal for permission or by a hook is not one.
const lostRace = (stderr: string): boolean =>
  /\[rejected\]|non-fast-forward|fetch first/.test(stderr) || /\[remote rejected\][^\n]*cannot lock ref[^\n]*but expected/.test(stderr);

// Where a fetched tip is kept in the clone, so its objects outlive the fetch.
const mirror = (ref: string): string => `refs/kit-shared/${ref.replace(/^refs\//, "")}`;

export const gitRefs: GitRefs = {
  read(root, ref) {
    const tip = output(root, ["ls-remote", "origin", ref])
      .split("\n")
      .map((line) => line.split("\t"))
      .find(([, name]) => name === ref)?.[0];
    if (tip === undefined) return null;
    output(root, ["fetch", "--quiet", "--no-tags", "origin", `+${ref}:${mirror(ref)}`]);
    const files = output(root, ["ls-tree", "-r", "-z", tip])
      .split("\0")
      .filter((line) => line !== "")
      .flatMap((line) => {
        const [meta = "", path = ""] = line.split("\t");
        const [, type, blob] = meta.split(" ");
        return type === "blob" && blob !== undefined ? [{ path, blob }] : [];
      });
    return { tip, files };
  },
  texts(root, blobs) {
    if (blobs.length === 0) return [];
    const stdout = git(root, ["cat-file", "--batch"], `${blobs.join("\n")}\n`).stdout;
    const texts: string[] = [];
    let at = 0;
    for (let index = 0; index < blobs.length; index++) {
      const end = stdout.indexOf(10, at);
      if (end < 0) break;
      const header = stdout.subarray(at, end).toString("utf8").split(" ");
      if (header[1] !== "blob") {
        texts.push("");
        at = end + 1;
        continue;
      }
      const size = Number(header[2]);
      texts.push(stdout.subarray(end + 1, end + 1 + size).toString("utf8"));
      at = end + 1 + size + 1;
    }
    return texts;
  },
  advance(root, ref, expected, files, message) {
    // The commit is built in one fast-import on a scratch ref of this process, from the expected tip's tree.
    const scratch = `refs/kit-shared/scratch/${process.pid}`;
    const parts: Buffer[] = [];
    const add = (text: string): void => {
      parts.push(Buffer.from(text, "utf8"));
    };
    const data = (text: string): void => add(`data ${Buffer.byteLength(text, "utf8")}\n${text}\n`);
    add(`reset ${scratch}\ncommit ${scratch}\ncommitter Kit <kit@localhost> now\n`);
    data(message);
    if (expected !== null) add(`from ${expected}\n`);
    for (const file of files) {
      add(`M 100644 inline ${file.path}\n`);
      data(file.text);
    }
    add("done\n");
    output(root, ["fast-import", "--quiet", "--force", "--date-format=now", "--done"], Buffer.concat(parts));
    const commit = output(root, ["rev-parse", scratch]).trim();
    output(root, ["update-ref", "-d", scratch]);
    // A push of this ref carries no code, so the clone's own push hooks, which may run this gate, are not run.
    const push = git(root, ["push", "--quiet", "--no-verify", "origin", `${commit}:${ref}`]);
    if (push.status === 0) return commit;
    if (lostRace(push.stderr)) return null;
    throw new Error(`git push: ${said(push.stderr)}`);
  },
};

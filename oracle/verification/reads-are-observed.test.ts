import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { heldKeys, heldPath, pathUses } from "../../src/core/readings/verdict-reuse.js";
import { processes } from "../../src/substrate/adapters/processes.js";
import { readRecorder } from "../../src/substrate/adapters/read-recorder.mjs";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const recorded = async (app: string, reads: string, line: string) => {
  const [result] = await processes.shells([{ line, env: { NODE_OPTIONS: `--import ${readRecorder.location}`, KIT_READS: reads, KIT_ROOT: app } }], app);
  expect(result?.stderr ?? "").toBe("");
  expect(result?.status).toBe(0);
  const recordings = readdirSync(reads).filter((name) => name.endsWith(".txt")).map((name) => readFileSync(join(reads, name), "utf8"));
  return pathUses(recordings);
};

test("a check's reads, listings, probes and loads are recorded in its process, its threads and the processes it starts, but not the test runner's listings", async () => {
  const project = temporaryProjects.open("kit-reads-");
  projects.push(project);
  const app = join(project.root, "app");
  const reads = join(project.root, "reads");
  project.write({
    "app/main.mjs": [
      'import { readFileSync, existsSync, readdirSync } from "node:fs";',
      'import { readFile } from "node:fs/promises";',
      'import { Worker } from "node:worker_threads";',
      'import { execSync } from "node:child_process";',
      'readFileSync("a.txt");',
      'existsSync("missing.txt");',
      'readdirSync("listed");',
      'await readFile("promised.txt");',
      'readFileSync("node_modules/pkg/index.js");',
      'const { list } = await import("./node_modules/pkg/index.js");',
      'list("package-listed");',
      'const { find } = await import("./node_modules/vitest/index.js");',
      'find("runner-listed");',
      'readFileSync("../outside.txt");',
      'await new Promise((done) => new Worker("./worker.mjs").on("exit", done));',
      'execSync("node child.mjs");',
    ].join("\n"),
    "app/worker.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("from-worker.txt");\n',
    "app/child.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("from-child.txt");\n',
    "app/a.txt": "a",
    "app/promised.txt": "p",
    "app/from-worker.txt": "w",
    "app/from-child.txt": "c",
    "app/listed/one.txt": "1",
    "app/node_modules/pkg/index.js": 'import { readdirSync, readFileSync } from "node:fs";\nexport const list = (dir) => { readdirSync(dir); readFileSync("read-by-package.txt"); };\n',
    "app/node_modules/vitest/index.js": 'import { readdirSync } from "node:fs";\nexport const find = (dir) => { [1].forEach(() => readdirSync(dir)); };\n',
    "app/package-listed/x.txt": "x",
    "app/runner-listed/x.txt": "x",
    "app/read-by-package.txt": "r",
    "outside.txt": "o",
    "reads/.keep": "",
  });
  const uses = await recorded(app, reads, "node main.mjs");
  const kinds = Object.fromEntries([...uses].map(([path, used]) => [path, [...used].sort()]));
  expect(kinds).toMatchObject({
    "a.txt": ["read"],
    "promised.txt": ["read"],
    "read-by-package.txt": ["read"],
    "from-worker.txt": ["read"],
    "from-child.txt": ["read"],
    "missing.txt": ["probe"],
    listed: ["list"],
    "package-listed": ["list"],
    "main.mjs": expect.arrayContaining(["load"]),
    "worker.mjs": expect.arrayContaining(["load"]),
    "child.mjs": expect.arrayContaining(["load"]),
    // An installed package's files are recorded as the package they fall in.
    "node_modules/pkg": ["package"],
    "node_modules/vitest": ["package"],
  });
  expect([...uses.keys()].filter((path) => path.includes("node_modules/") ? uses.get(path)?.has("package") !== true : path.includes("outside") || path === "runner-listed")).toEqual([]);
});

test("the app root's own listing, recursive listings, copies, links, globs and native probes are recorded, whatever the stack trace limit", async () => {
  const project = temporaryProjects.open("kit-reads-");
  projects.push(project);
  const app = join(project.root, "app");
  const reads = join(project.root, "reads");
  project.write({
    "app/main.mjs": [
      'import fs from "node:fs";',
      "Error.stackTraceLimit = 0;",
      'fs.readFileSync("a.txt");',
      'fs.readdirSync(".");',
      'fs.readdirSync("tree", { recursive: true });',
      'fs.copyFileSync("copied.txt", "../copy-out.txt");',
      'fs.cpSync("copied-dir", "../copy-dir-out", { recursive: true });',
      'fs.symlinkSync("a.txt", "link");',
      'fs.readlinkSync("link");',
      'fs.realpathSync.native("native.txt");',
      'fs.statfsSync("statfs.txt");',
      'fs.globSync("globbed/*.txt");',
      'for await (const entry of await fs.promises.opendir("opened")) void entry;',
    ].join("\n"),
    "app/a.txt": "a",
    "app/tree/one.txt": "1",
    "app/tree/sub/two.txt": "2",
    "app/copied.txt": "c",
    "app/copied-dir/inner/f.txt": "f",
    "app/native.txt": "n",
    "app/statfs.txt": "s",
    "app/globbed/g.txt": "g",
    "app/opened/o.txt": "o",
    "reads/.keep": "",
  });
  const uses = await recorded(app, reads, "node main.mjs");
  const kinds = Object.fromEntries([...uses].map(([path, used]) => [path, [...used].sort()]));
  expect(kinds).toMatchObject({
    "a.txt": ["read"],
    ".": expect.arrayContaining(["list"]),
    tree: ["list"],
    "tree/sub": ["list"],
    "copied.txt": ["read"],
    "copied-dir": expect.arrayContaining(["list"]),
    "copied-dir/inner": ["list"],
    "copied-dir/inner/f.txt": ["read"],
    link: ["read"],
    "native.txt": ["probe"],
    "statfs.txt": ["probe"],
    globbed: expect.arrayContaining(["list"]),
    opened: ["list"],
  });
});

test("a compiler expanding its configuration's globs, from an installed package, lists what it expands", async () => {
  const project = temporaryProjects.open("kit-reads-");
  projects.push(project);
  const app = join(project.root, "app");
  const reads = join(project.root, "reads");
  project.write({
    "app/tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: true, strict: true, types: [] }, include: ["src/**/*.ts"] }),
    "app/src/a.ts": "export const a: number = 1;\n",
    "app/src/deep/b.ts": "export const b: number = 2;\n",
    "reads/.keep": "",
  });
  const tsc = new URL("../../node_modules/typescript/bin/tsc", import.meta.url).pathname;
  const uses = await recorded(app, reads, `node ${tsc} -p tsconfig.json`);
  expect([...(uses.get("src") ?? [])]).toContain("list");
  expect([...(uses.get("src/deep") ?? [])]).toContain("list");
}, 60_000);

test("a check that globs files through an installed package, or lists the app root, runs again when a new file appears there", async () => {
  const project = temporaryProjects.open("kit-reads-");
  projects.push(project);
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: lint, command: node lint.mjs}\n    - {id: top, command: node top.mjs}\n```\n",
    "top.mjs": 'import { readdirSync } from "node:fs";\nreaddirSync(process.cwd());\n',
    "lint.mjs": 'import { files } from "./node_modules/globber/index.js";\nif (files("src").length === 0) process.exit(1);\n',
    "node_modules/globber/index.js": 'import { readdirSync } from "node:fs";\nexport const files = (dir) => readdirSync(dir);\n',
    "src/a.mjs": "export const a = 1;\n",
  });
  const config = join(project.root, "kit/config.md");
  const verify = (...flags: string[]) => runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", config, ...flags], cwd: project.root });
  expect((await verify()).exitCode).toBe(0);
  expect((await verify("--plan")).stdout).toBe("reuse lint\nreuse top\n");
  project.write({ "src/b.mjs": "export const b = 2;\n" });
  expect((await verify("--plan")).stdout).toBe("run lint\nreuse top\n");
  project.write({ "tsconfig.json": "{}\n" });
  expect((await verify("--plan")).stdout).toBe("run lint\nrun top\n");
});

test("the recorder is added to the options the caller's environment gives Node, not put in their place", async () => {
  const project = temporaryProjects.open("kit-reads-");
  projects.push(project);
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: options, command: node options.mjs}\n```\n",
    "options.mjs": 'if (!process.env.NODE_OPTIONS.includes("--no-deprecation")) process.exit(1);\n',
  });
  // `kit verify` runs in a process of its own whose environment gives Node an option.
  const launcher = new URL("../../scripts/kit-verify.mjs", import.meta.url).pathname;
  const [result] = await processes.shells(
    [{ line: `node ${launcher} --root ${project.root} --config ${join(project.root, "kit/config.md")}`, env: { NODE_OPTIONS: "--no-deprecation", KIT_READS: "", KIT_ROOT: "" } }],
    project.root,
  );
  expect(result?.stderr).toBe("");
  expect(result?.status).toBe(0);
}, 60_000);

test("loaded without being asked to record, the recorder changes nothing", async () => {
  expect(readRecorder.location.endsWith("read-recorder.mjs")).toBe(true);
  const project = temporaryProjects.open("kit-reads-");
  projects.push(project);
  project.write({ "probe.mjs": 'import fs from "node:fs";\nconsole.log(fs.readFileSync.toString().includes("note(") ? "wrapped" : "native");\n' });
  // Recording is asked for by both variables; a gate recording this test sets them, so the probe clears them.
  const [result] = await processes.shells(
    [{ line: "node probe.mjs", env: { NODE_OPTIONS: `--import ${readRecorder.location}`, KIT_READS: "", KIT_ROOT: "" } }],
    project.root,
  );
  expect(result?.stdout.trim()).toBe("native");
});

test("recordings are read as each path's uses, and each path is kept by what it was used for", () => {
  const uses = pathUses(["read b.txt\nprobe a.txt\n", "probe a.txt\nload m.mjs\nload n.mjs\nread n.mjs\nlist d\n\n"]);
  expect(heldKeys(uses, new Map([["m.mjs", [0, 2]], ["n.mjs", [1]]]))).toEqual(["a.txt#kind", "b.txt", "d", "m.mjs#ran:0,2", "n.mjs"]);
  expect(heldKeys(new Map([["m.mjs", new Set(["load"])]]), new Map())).toEqual(["m.mjs"]);
  expect(heldKeys(new Map([["d.json", new Set(["load"])], ["v.tsx", new Set(["load"])]]), new Map([["d.json", []], ["v.tsx", [1]]]))).toEqual(["d.json", "v.tsx#ran:1"]);
  expect(heldPath("m.mjs#ran:0,2")).toEqual({ path: "m.mjs", kind: false, ran: [0, 2] });
  expect(heldPath("m.mjs#ran:")).toEqual({ path: "m.mjs", kind: false, ran: [] });
  expect(heldPath("a.txt#kind")).toEqual({ path: "a.txt", kind: true });
  expect(heldPath("odd#name.txt")).toEqual({ path: "odd#name.txt", kind: false });
  // An installed package is kept by its lockfile path; a manifest only a loader read, without its scripts; and the
  // lockfile only a loader read, through the packages alone.
  expect(heldKeys(pathUses(["package node_modules/@a/b\nload package.json\nload package-lock.json\nload lib/package.json\nread lib/package.json"]), new Map())).toEqual([
    "#package:node_modules/@a/b",
    "lib/package.json",
    "package.json#manifest",
  ]);
  expect(heldPath("#package:node_modules/a/node_modules/b")).toEqual({ path: "#package:node_modules/a/node_modules/b", kind: false, package: "node_modules/a/node_modules/b" });
  expect(heldPath("package.json#manifest")).toEqual({ path: "package.json", kind: false, manifest: true });
});

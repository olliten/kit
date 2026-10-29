import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readPaths } from "../../src/core/readings/verdict-reuse.js";
import { processes } from "../../src/substrate/adapters/processes.js";
import { readRecorder } from "../../src/substrate/adapters/read-recorder.mjs";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

test("a check's reads, listings and probes are recorded in its process, its threads and the processes it starts, but not a package's listings", async () => {
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
      'list("runner-listed");',
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
    "app/runner-listed/x.txt": "x",
    "app/read-by-package.txt": "r",
    "outside.txt": "o",
    "reads/.keep": "",
  });
  const [result] = await processes.shells(
    [{ line: "node main.mjs", env: { NODE_OPTIONS: `--import ${readRecorder.location}`, KIT_READS: reads, KIT_ROOT: app } }],
    app,
  );
  expect(result?.status).toBe(0);
  const recordings = readdirSync(reads).filter((name) => name.endsWith(".txt")).map((name) => readFileSync(join(reads, name), "utf8"));
  const recorded = readPaths(recordings);
  for (const path of ["read-by-package.txt", "a.txt", "missing.txt", "listed", "promised.txt", "worker.mjs", "from-worker.txt", "child.mjs", "from-child.txt", "main.mjs"])
    expect(recorded).toContain(path);
  expect(recorded.filter((path) => path.includes("node_modules") || path.includes("outside") || path === "runner-listed")).toEqual([]);
});

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

test("recordings are read as each path once", () => {
  expect(readPaths(["b.txt\na.txt\n", "a.txt\n\n"])).toEqual(["a.txt", "b.txt"]);
});

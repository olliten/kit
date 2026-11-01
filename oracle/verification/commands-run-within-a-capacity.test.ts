import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { verdictKind, verdictOf } from "../../src/core/readings/verdict-reuse.js";
import { testLine } from "../../src/core/readings/verification-configuration.js";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

// A runner for several test files, as vitest is to Kit: it forks a process per file and sends it the file, as
// vitest's worker message does, writes each file's result and executed script as Kit's provider does, and holds
// the invocation a while, so what overlaps it shows. Each start and end is stamped outside the app.
const RUNNER = [
  'import { fork } from "node:child_process";',
  'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";',
  "const [stamps, dir, , ...files] = process.argv.slice(2);",
  "const root = process.cwd();",
  "const label = `${files.length > 1 ? 'chunk' : 'alone'}:${files[0]}`;",
  "appendFileSync(stamps, `start ${label} ${Date.now()}\\n`);",
  "const results = [];",
  "for (let at = 0; at < files.length; at += 8)",
  "  results.push(...(await Promise.all(files.slice(at, at + 8).map((file) => new Promise((resolve) => {",
  '    const child = fork("worker.mjs");',
  "    child.send({ task: { files: [`${root}/${file}`] } });",
  '    child.on("exit", (code) => resolve(code === 0));',
  "  })))));",
  "await new Promise((resolve) => setTimeout(resolve, files.length > 1 ? 2000 : 0));",
  'writeFileSync(`${dir}/batch.json`, JSON.stringify({ errors: 0 }));',
  "files.forEach((file, index) => {",
  "  const own = `${dir}/${encodeURIComponent(file)}`;",
  "  mkdirSync(own, { recursive: true });",
  '  writeFileSync(`${own}/run.json`, JSON.stringify({ test: file, state: results[index] ? "pass" : "fail", scripts: [`${root}/${file}`] }));',
  "});",
  "appendFileSync(stamps, `end ${label} ${Date.now()}\\n`);",
  "process.exit(results.every(Boolean) ? 0 : 1);",
  "",
].join("\n");
const WORKER = [
  'import { readFileSync } from "node:fs";',
  'process.on("message", (message) => process.exit(readFileSync(message.task.files[0], "utf8").includes("fail") ? 1 : 0));',
  "",
].join("\n");
// A whole-tree check that holds a while and exits as told.
const STAMP = [
  'import { appendFileSync } from "node:fs";',
  "const [stamps, label, wait, code] = process.argv.slice(2);",
  "appendFileSync(stamps, `start check:${label} ${Date.now()}\\n`);",
  "await new Promise((resolve) => setTimeout(resolve, Number(wait)));",
  "appendFileSync(stamps, `end check:${label} ${Date.now()}\\n`);",
  "process.exit(Number(code ?? 0));",
  "",
].join("\n");

type Stamp = { readonly label: string; readonly start: number; readonly end: number };

function app(tests: number) {
  const project = temporaryProjects.open("kit-capacity-");
  const outside = temporaryProjects.open("kit-capacity-stamps-");
  projects.push(project, outside);
  const stamps = join(outside.root, "stamps.txt");
  const command = `node runner.mjs ${stamps} {dir} {provider} {tests}`;
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "package.json": JSON.stringify({ type: "module" }),
    "runner.mjs": RUNNER,
    "worker.mjs": WORKER,
    "stamp.mjs": STAMP,
    ...Object.fromEntries(Array.from({ length: tests }, (_, index) => [`tests/t${String(index).padStart(3, "0")}.test.mjs`, "export {};\n"])),
  });
  const configure = (verify: string) =>
    project.write({ "kit/config.md": `\`\`\`yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n${verify}\`\`\`\n` });
  const check = (id: string, wait: number, code = 0, needs: readonly string[] = []) =>
    `    - id: ${id}\n      command: node stamp.mjs ${stamps} ${id} ${wait} ${code}\n${needs.length > 0 ? `      needs: [${needs.join(", ")}]\n` : ""}`;
  const group = `  tests:\n    command: ${command}\n    under: tests/\n`;
  const verify = (...flags: string[]) =>
    runVerify({ engineRoot: project.root, args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), ...flags], cwd: project.root });
  // Each command's start and end, and, from them, the most of the capacity that ran at once.
  const stamped = (): Stamp[] => {
    const lines = textFiles.exists(stamps) ? textFiles.read(stamps).split("\n").filter(Boolean) : [];
    textFiles.write(stamps, "");
    const starts = new Map<string, number>();
    const all: Stamp[] = [];
    for (const line of lines) {
      const [edge = "", label = "", time = "0"] = line.split(" ");
      if (edge === "start") starts.set(label, Number(time));
      else all.push({ label, start: starts.get(label) ?? Number.NaN, end: Number(time) });
    }
    return all;
  };
  const kept = (test: string): string[] => {
    const kind = verdictKind(`test:${test}`, testLine(command, test), toolchain.runtime(project.root));
    const [pass] = evidenceStore.entries(evidenceStore.directory(project.root), kind).flatMap((text) => verdictOf(text) ?? []);
    return Object.keys(pass?.states ?? {}).filter((path) => !path.endsWith("#kind") && !path.startsWith("#package:")).sort();
  };
  return { project, configure, check, group, verify, stamped, kept };
}

const summary = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf("Kit verify ") + 11));
const overlap = (a: Stamp, b: Stamp): boolean => a.start < b.end && b.start < a.end;
// The most of the capacity taken at once: a chunk takes half of it, any other command one.
const peak = (stamps: readonly Stamp[], capacity: number): number =>
  Math.max(
    ...stamps.map((at) =>
      stamps.filter((each) => each.start <= at.start && at.start < each.end).reduce((sum, each) => sum + (each.label.startsWith("chunk:") ? capacity / 2 : 1), 0),
    ),
  );

test("a chunk starts while another finishes, within the capacity, and each test keeps only its own reads", async () => {
  const { configure, check, group, verify, stamped, kept, project } = app(130);
  configure(`  capacity: 4\n  checks:\n${check("one", 300)}${check("two", 300)}${check("three", 300)}${group}`);
  const result = await verify();
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(summary(result.stdout)).toMatchObject({ ran: 133, failed: 0, recorded: 133, alone: 0 });
  const stamps = stamped();
  const chunks = stamps.filter((stamp) => stamp.label.startsWith("chunk:")).sort((a, b) => a.start - b.start);
  expect(chunks.map((chunk) => chunk.label)).toEqual(["chunk:tests/t000.test.mjs", "chunk:tests/t064.test.mjs", "chunk:tests/t128.test.mjs"]);
  const [first, second, third] = chunks;
  if (first === undefined || second === undefined || third === undefined) throw new Error("three chunks ran");
  expect(overlap(first, second)).toBe(true);
  expect(peak(stamps, 4)).toBeLessThanOrEqual(4);
  // A test of the second chunk, run beside the first, keeps its own file and the runner's, not another test's.
  expect(kept("tests/t100.test.mjs")).toEqual(["runner.mjs", "tests/t100.test.mjs", "worker.mjs"]);
  project.write({ "tests/t100.test.mjs": "export const edited = 1;\n" });
  const planned = (await verify("--plan")).stdout.split("\n").filter((line) => line.startsWith("run "));
  expect(planned).toEqual(["run test:tests/t100.test.mjs"]);
}, 240_000);

test("a group's own capacity keeps its chunks apart, and a failing test loses no other chunk's passes", async () => {
  const { configure, group, verify, stamped, project } = app(130);
  project.write({ "tests/t010.test.mjs": "// fail\n" });
  configure(`  capacity: 4\n  checks: []\n${group}    capacity: 1\n`);
  const result = await verify();
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("failed test:tests/t010.test.mjs\n");
  expect(summary(result.stdout)).toMatchObject({ ran: 130, failed: 1, recorded: 129 });
  const chunks = stamped().filter((stamp) => stamp.label.startsWith("chunk:"));
  expect(chunks).toHaveLength(3);
  for (const a of chunks) for (const b of chunks) if (a !== b) expect(overlap(a, b)).toBe(false);
  const planned = (await verify("--plan")).stdout.split("\n").filter((line) => line.startsWith("run "));
  expect(planned).toEqual(["run test:tests/t010.test.mjs"]);
}, 240_000);

test("a check starts once the checks it needs have passed, others run beside them, and one whose need failed fails unrun", async () => {
  const { configure, check, verify, stamped } = app(0);
  configure(`  capacity: 4\n  checks:\n${check("build", 600)}${check("after", 0, 0, ["build"])}${check("beside", 600)}`);
  const passed = await verify();
  expect(passed.exitCode).toBe(0);
  const stamps = new Map(stamped().map((stamp) => [stamp.label, stamp]));
  const build = stamps.get("check:build");
  const after = stamps.get("check:after");
  const beside = stamps.get("check:beside");
  if (build === undefined || after === undefined || beside === undefined) throw new Error("every check ran");
  expect(after.start).toBeGreaterThanOrEqual(build.end);
  expect(overlap(build, beside)).toBe(true);

  // A check whose pass still holds is reused whatever its needs did, so this one is changed.
  configure(`  capacity: 4\n  checks:\n${check("build", 0, 1)}${check("after", 1, 0, ["build"])}${check("beside", 0)}`);
  const failed = await verify();
  expect(failed.exitCode).toBe(1);
  expect(failed.stdout).toContain("failed after\n");
  expect(failed.stderr).toContain("after failed:\nnot run: it needs build, which failed.\n");
  expect(stamped().map((stamp) => stamp.label).sort()).toEqual(["check:beside", "check:build"]);
  expect(summary(failed.stdout)).toMatchObject({ failed: 2 });
}, 240_000);

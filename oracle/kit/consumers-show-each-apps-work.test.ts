import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";

import { describeConsumer, pinnedKit, readCheck } from "../../src/core/readings/consumer-report.js";
import { processes } from "../../src/substrate/adapters/processes.js";
import { runConsumers } from "../../src/substrate/compositions/consumers-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const scratch = mkdtempSync(join(tmpdir(), "kit-consumers-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lock = (resolved: string) =>
  JSON.stringify({ packages: { "node_modules/kit": { resolved } } });

test("an app's pinned Kit is read from its lockfile, and an app without one pins none", () => {
  const app = join(scratch, "pinned");
  mkdirSync(app);
  writeFileSync(join(app, "package-lock.json"), lock("git+ssh://git@github.com/olliten/kit.git#552affb535b1"));
  expect(pinnedKit(readFileSync(join(app, "package-lock.json"), "utf8"))).toBe("552affb535b1");
  expect(pinnedKit(null)).toBeNull();
});

test("a check's failures are grouped by check, and its counts are kept", () => {
  const read = readCheck(
    'Kit check {"counts":{"placed-violation:topic-shape":2}}\nKit limit R1:x:y: a limit\n',
    "R4:topic-shape:spec/a.md:3: Move this prose.\nR4:topic-shape:spec/b.md:1: Start with a title.\nR3:term-order:step:4: Place step first.\n",
  );
  expect(read.counts).toEqual({ "placed-violation:topic-shape": 2 });
  expect(read.byCheck).toEqual({ "topic-shape": 2, "term-order": 1 });
  expect(read.failures[0]).toEqual({
    rule: "R4",
    check: "topic-shape",
    key: "R4:topic-shape:spec/a.md:3",
    fix: "Move this prose.",
  });
});

test("an app that passes says so; one that fails lists its work under its pin", () => {
  const base = { app: "shop", kit: "0b955dfbeff8", failures: [], byCheck: {} };
  expect(describeConsumer({ ...base, pinned: "0b955df", exitCode: 0 })).toBe("shop: passes (pins this Kit).");
  expect(describeConsumer({ ...base, pinned: null, exitCode: 0 })).toBe("shop: passes (pins no Kit).");
  const failing = readCheck("", "R4:unreferenced-module:core/readings/total: Name {{total}}.\n");
  expect(describeConsumer({ ...base, pinned: "552affb", exitCode: 1, ...failing })).toBe(
    "shop: 1 failing (pins 552affb): unreferenced-module 1\n  R4:unreferenced-module:core/readings/total: Name {{total}}.",
  );
});

test("the composition exchanges the real child protocol without booting the Kit application", async () => {
  const project = temporaryProjects.open("kit-consumer-contract-");
  const engineRoot = join(project.root, "engine");
  try {
    project.write({
      "engine/scripts/kit-check.mjs": [
        'import assert from "node:assert/strict";',
        'import { readFileSync } from "node:fs";',
        'const root = process.argv[3];',
        'assert.deepEqual(process.argv.slice(2), JSON.parse(readFileSync(`${root}/expected-argv.json`, "utf8")));',
        'const mode = readFileSync(`${root}/mode.txt`, "utf8");',
        'if (mode === "pass") process.stdout.write("Kit check {\\"counts\\":{}}\\n");',
        'else if (mode === "findings") { process.stderr.write("R4:unreferenced-module:src/legacy/new.ts: Name the module.\\n"); process.exitCode = 1; }',
        'else if (mode === "config") { process.stderr.write(`Kit config ${root}/kit/config.md: stale key.\\n`); process.exitCode = 1; }',
        'else { process.stderr.write("consumer child crashed\\n"); process.exitCode = 2; }',
      ].join("\n"),
    });
    expect(processes.run("git", ["init", "--quiet"], engineRoot).status).toBe(0);
    expect(processes.run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "fixture"], engineRoot).status).toBe(0);
    const head = processes.run("git", ["rev-parse", "HEAD"], engineRoot).stdout.trim();
    const other = `${head.startsWith("a") ? "b" : "a"}${head.slice(1)}`;
    for (const [name, mode, directory] of [["passing", "pass", true], ["failing", "findings", false], ["stale", "config", false], ["crash", "crash", false]] as const) {
      const root = join(project.root, name);
      if (directory) project.directory(`${name}/kit/debt/legacy`);
      project.write({
        [`${name}/mode.txt`]: mode,
        [`${name}/expected-argv.json`]: JSON.stringify(["--root", root, "--config", `${root}/kit/config.md`, "--baseline", `${root}/kit/debt/legacy${directory ? "" : ".json"}`]),
        [`${name}/kit/config.md`]: "fixture configuration",
        [`${name}/package-lock.json`]: lock(`git+https://github.com/olliten/kit.git#${name === "passing" ? head : other}`),
      });
    }
    const result = await runConsumers({ engineRoot, args: ["passing", "failing", "stale"], cwd: project.root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `passing: passes (pins this Kit).\nfailing: 1 failing (pins ${other.slice(0, 7)}): unreferenced-module 1\n` +
      `  R4:unreferenced-module:src/legacy/new.ts: Name the module.\nstale: Kit config ${project.root}/stale/kit/config.md: stale key.\n`,
    );
    await expect(runConsumers({ engineRoot, args: ["crash"], cwd: project.root })).rejects.toThrow("consumer child crashed");
    await expect(runConsumers({ engineRoot, args: [], cwd: project.root })).rejects.toThrow("Name the app checkouts");
  } finally {
    project.dispose();
  }
});

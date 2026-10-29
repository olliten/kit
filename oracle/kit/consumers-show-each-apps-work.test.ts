import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vitest";

import { describeConsumer, pinnedKit, readCheck } from "../../src/core/readings/consumer-report.js";
import { runConsumers } from "../../src/substrate/compositions/consumers-run.js";

const engine = resolve(import.meta.dirname, "../..");
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

test("the real run checks an app checkout against this Kit and does not fail on the app's findings", async () => {
  const app = join(scratch, "tally");
  cpSync(join(engine, "examples/tally"), app, { recursive: true });
  // The known violation: a module no claim names, planted in the copy of the clean example.
  mkdirSync(join(app, "src/substrate/compositions"), { recursive: true });
  writeFileSync(join(app, "src/substrate/compositions/save.ts"), "export function save(text: string): string {\n  return text;\n}\n");
  writeFileSync(join(app, "package-lock.json"), lock("git+https://github.com/olliten/kit.git#552affb"));
  const { stdout: output, exitCode } = await runConsumers({ engineRoot: engine, args: [app], cwd: engine });
  expect(exitCode).toBe(0);
  expect(output).toMatch(/^tally: \d+ failing \(pins 552affb\): /);
  expect(output).toContain("  R4:unreferenced-module:substrate/compositions/save:");
}, 120_000);

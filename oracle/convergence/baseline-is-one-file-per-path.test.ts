import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { baselineFileOf, baselineFiles, mergedBaseline } from "../../src/core/readings/baseline-files.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const engine = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

test("a baseline record is kept as one file per finding path, and read back whole", () => {
  const record = {
    "R1:type-escape:lib/old.ts:a": null,
    "R1:type-escape:lib/old.ts:b": null,
    "R1:legacy-size:lib/other.ts": { statements: 3, calls: 0 },
  };
  const files = baselineFiles("kit/debt/legacy", record);
  expect([...files.keys()].sort()).toEqual([baselineFileOf("kit/debt/legacy", "lib/old.ts"), baselineFileOf("kit/debt/legacy", "lib/other.ts")]);
  expect(baselineFileOf("kit/debt/legacy", "lib/old.ts")).toBe("kit/debt/legacy/lib+old.ts.json");
  expect(mergedBaseline([...files].map(([path, text]) => ({ path, text })))).toEqual(record);
  expect(() => mergedBaseline([{ path: "kit/debt/legacy/x.json", text: "[]" }])).toThrow(/x\.json: a baseline file is a record/);
});

test("kit check reads a baseline directory, and tightening rewrites only the paths whose debt was paid", async () => {
  const project = temporaryProjects.open("kit-baseline-");
  projects.push(project);
  const app = join(project.root, "app");
  cpSync(join(engine, "examples/tally"), app, { recursive: true });
  const config = join(app, "kit/config.md");
  writeFileSync(config, readFileSync(config, "utf8").replace("```yaml\n", "```yaml\nlayout: {legacy: [lib/]}\n").replace("  src: src/\n", "  src: [src/, oracle/]\n"));
  mkdirSync(join(app, "lib"));
  writeFileSync(join(app, "lib/old.ts"), "export const old = 1;\n");
  writeFileSync(join(app, "lib/paid.ts"), "export const paid = 1;\n");
  const debt = join(app, "kit/debt/legacy");
  const check = (...flags: string[]) =>
    runCheck({ engineRoot: engine, args: ["--root", app, "--config", config, "--baseline", debt, ...flags], cwd: app });

  const report: { findings: { debtKey: string; category: string; statements?: number; calls?: number }[] } = JSON.parse(
    (await check("--report")).stdout,
  );
  const owed = report.findings.filter((item) => item.category === "legacy-debt" || item.category === "proof-debt");
  expect(owed.filter((item) => item.debtKey.includes(":lib/paid.ts")).length).toBeGreaterThan(0);
  expect((await check()).exitCode).toBe(1);

  // A legacy module's size is kept with the key, as an adopting app's first baseline holds it.
  const kept = Object.fromEntries(
    owed.map((item) => [item.debtKey, item.statements === undefined ? null : { statements: item.statements, calls: item.calls }]),
  );
  mkdirSync(debt, { recursive: true });
  for (const [path, text] of baselineFiles(debt, kept)) writeFileSync(path, text);
  const before = readFileSync(baselineFileOf(debt, "lib/old.ts"), "utf8");
  expect((await check()).exitCode).toBe(0);

  // Paying one path's debt removes that path's file and leaves the others as they were.
  rmSync(join(app, "lib/paid.ts"));
  expect((await check("--tighten")).exitCode).toBe(0);
  expect(existsSync(baselineFileOf(debt, "lib/paid.ts"))).toBe(false);
  expect(readFileSync(baselineFileOf(debt, "lib/old.ts"), "utf8")).toBe(before);
  expect(readdirSync(debt).length).toBeGreaterThan(0);
}, 120_000);

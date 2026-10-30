import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { baselineFileOf, baselineFiles } from "../../src/core/readings/baseline-files.js";
import { paidDebt } from "../../src/core/readings/paid-debt.js";
import type { GateFinding } from "../../src/core/readings/ratchet.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const engine = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const tighten = "Run `kit check --tighten` to drop paid debt.";
const kept = "src/legacy/kept.ts";
const paid = "src/legacy/paid.ts";
const sizeKey = `R1:legacy-size:${kept}`;

// An app whose only code is unplaced, so each module is legacy debt with a recorded size.
function app() {
  const project = temporaryProjects.open("kit-paid-debt-");
  projects.push(project);
  project.write({
    [kept]: "export function kept(values: readonly number[]): number {\n  const count = values.length;\n  return count;\n}\n",
    [paid]: "export const paid = 1;\n",
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [], skipLibCheck: true },
      include: ["src/**/*.ts"],
    }),
    "package.json": JSON.stringify({ type: "module" }),
    "kit/config.md": "```yaml\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nlegacy-areas: []\nadapters: []\npackages: []\n```\n",
    "spec/terms.md": "# Terms\n",
  });
  const check = (baseline: string, ...flags: string[]) =>
    runCheck({
      engineRoot: engine,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--baseline", join(project.root, baseline), ...flags],
      cwd: project.root,
    });
  return { project, check };
}

// What an adopting app's first baseline records: every debt key, and each legacy module's size.
async function owed(check: ReturnType<typeof app>["check"]): Promise<Record<string, unknown>> {
  const report: { findings: { debtKey: string; category: string; statements?: number; calls?: number }[] } = JSON.parse(
    (await check("kit/none.json", "--report")).stdout,
  );
  return Object.fromEntries(
    report.findings
      .filter((item) => item.category === "legacy-debt" || item.category === "proof-debt")
      .map((item) => [item.debtKey, item.statements === undefined ? null : { statements: item.statements, calls: item.calls }]),
  );
}

const linesOf = (stderr: string): string[] => stderr.split("\n").filter((line) => line !== "");

test("a key no finding holds fails with the fix to tighten, one line per key, until tightening drops it", async () => {
  const { project, check } = app();
  const record = await owed(check);
  expect(Object.keys(record).some((key) => key.includes(`:${paid}`))).toBe(true);
  project.write({ "kit/debt.json": JSON.stringify(record, null, 2) + "\n" });
  expect((await check("kit/debt.json")).exitCode).toBe(0);

  project.remove(paid);
  const failed = await check("kit/debt.json");
  expect(failed.exitCode).toBe(1);
  const gone = Object.keys(record).filter((key) => key.includes(`:${paid}`));
  expect(linesOf(failed.stderr)).toEqual(gone.sort().map((key) => `${key}: No finding has this debt key any more. ${tighten}`));

  const tightened = await check("kit/debt.json", "--tighten");
  expect(tightened.stderr).toBe("");
  expect(tightened.exitCode).toBe(0);
  const left = Object.keys(JSON.parse(readFileSync(join(project.root, "kit/debt.json"), "utf8")));
  expect(left.filter((key) => key.includes(`:${paid}`))).toEqual([]);
  expect(left.length).toBeGreaterThan(0);
  expect((await check("kit/debt.json")).exitCode).toBe(0);
}, 120_000);

test("a legacy module smaller than its recorded size fails until tightening records the smaller size", async () => {
  const { project, check } = app();
  const record = await owed(check);
  expect(record[sizeKey]).toEqual({ statements: 3, calls: 0 });
  project.write({ "kit/debt.json": JSON.stringify({ ...record, [sizeKey]: { statements: 5, calls: 1 } }) });

  const failed = await check("kit/debt.json");
  expect(failed.exitCode).toBe(1);
  expect(linesOf(failed.stderr)).toEqual([
    `${sizeKey}: This legacy module has shrunk: its baseline records 4 statements of its own in 5, and it now owes 3 in 3. ${tighten}`,
  ]);

  expect((await check("kit/debt.json", "--tighten")).exitCode).toBe(0);
  expect(JSON.parse(readFileSync(join(project.root, "kit/debt.json"), "utf8"))[sizeKey]).toEqual({ statements: 3, calls: 0 });
  expect((await check("kit/debt.json")).exitCode).toBe(0);
}, 120_000);

test("a baseline directory fails on a paid key in any of its files, and tightening removes the emptied file", async () => {
  const { project, check } = app();
  const record = { ...(await owed(check)), "R1:type-escape:src/legacy/gone.ts:a": null };
  const debt = join(project.root, "kit/debt");
  project.directory("kit/debt");
  for (const [path, text] of baselineFiles(debt, record)) project.write({ [path.slice(project.root.length + 1)]: text });
  const before = readFileSync(baselineFileOf(debt, kept), "utf8");

  const failed = await check("kit/debt");
  expect(failed.exitCode).toBe(1);
  expect(linesOf(failed.stderr)).toEqual([`R1:type-escape:src/legacy/gone.ts:a: No finding has this debt key any more. ${tighten}`]);

  expect((await check("kit/debt", "--tighten")).exitCode).toBe(0);
  expect(existsSync(baselineFileOf(debt, "src/legacy/gone.ts"))).toBe(false);
  expect(readFileSync(baselineFileOf(debt, kept), "utf8")).toBe(before);
  expect((await check("kit/debt")).exitCode).toBe(0);
}, 120_000);

test("a legacy module that only gains calls into placed code leaves its recorded size standing", () => {
  const item = (statements: number, calls: number): GateFinding => ({
    rule: "R1",
    path: kept,
    fix: "",
    debtKey: sizeKey,
    category: "legacy-debt",
    status: "legacy",
    blocking: false,
    limit: "",
    statements,
    calls,
  });
  const baseline = { [sizeKey]: { statements: 3, calls: 0 } };
  expect(paidDebt(baseline, [item(5, 2)])).toEqual([]);
  expect(paidDebt(baseline, [item(3, 0)])).toEqual([]);
  expect(paidDebt(baseline, [item(4, 2)]).map((entry) => entry.debtKey)).toEqual([sizeKey]);
  expect(paidDebt({ [sizeKey]: { statements: 3, calls: 0 }, "R1:x:y": null }, [item(3, 0)]).map((entry) => entry.debtKey)).toEqual(["R1:x:y"]);
});

test("a legacy function spanning fewer lines than its baseline records is paid until tightening records them", () => {
  const key = `R3:function-size:${kept}:kept`;
  const item = (lines: number): GateFinding => ({
    rule: "R3",
    path: kept,
    fix: "",
    debtKey: key,
    category: "legacy-debt",
    status: "legacy",
    blocking: false,
    limit: "",
    lines,
  });
  const baseline = { [key]: { lines: 150, reason: "split after the rewrite" } };
  expect(paidDebt(baseline, [item(150)])).toEqual([]);
  expect(paidDebt(baseline, [item(160)])).toEqual([]);
  expect(paidDebt(baseline, [item(140)])).toEqual([
    {
      debtKey: key,
      fix: `This legacy function has shrunk: its baseline records 150 lines, and it now spans 140. ${tighten}`,
      reason: "split after the rewrite",
    },
  ]);
});

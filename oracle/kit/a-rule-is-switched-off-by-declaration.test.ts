import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { gate } from "../../src/core/compositions/gate.js";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedFunctions } from "../substrate/compositions/recorded-functions.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const engine = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };
const reason = "The shell's browser tests run page code Node coverage does not record.";

// A module two claims each run a part of, neither naming it: debt to both rules that read what tests ran.
const module = "src/core/readings/text.ts";
const source =
  "export function parse(text: string): string[] { return text.split(','); }\n" +
  "export function sum(text: string): number { return parse(text).length; }\n" +
  "export function format(text: string): string { return parse(text).join(''); }\n";

function ran(config: Partial<KitConfig>): string[] {
  const snapshot: Snapshot = {
    ...projectSnapshot(recordedFunctions({ [module]: source }), config),
    files: [
      { path: module, type: "source" },
      { path: "oracle/text/sums.test.ts", type: "test" },
      { path: "oracle/text/formats.test.ts", type: "test" },
    ],
    claims: [
      { file: "spec/text.md", anchor: "sums", line: 1, terms: [] },
      { file: "spec/text.md", anchor: "formats", line: 2, terms: [] },
    ],
    runs: {
      tests: {
        "oracle/text/sums.test.ts": { [module]: ["parse@1", "sum@2"] },
        "oracle/text/formats.test.ts": { [module]: ["parse@1", "format@3"] },
      },
    },
  };
  const rules = new Set(gate(snapshot, snapshot.config).findings.map((item) => item.debtKey.split(":").slice(0, 2).join(":")));
  return ["R4:ungoverned-function", "R4:excerpt-cohesion"].filter((rule) => rules.has(rule));
}

test("a rule switched off reports no finding; the other still reports", () => {
  expect(ran({})).toEqual(["R4:ungoverned-function", "R4:excerpt-cohesion"]);
  const config = configuredKit(DEFAULT_CONFIG, { roots, rules: { "ungoverned-function": { off: reason } } });
  expect(config.rules).toEqual({ "ungoverned-function": { off: reason } });
  expect(ran({ rules: config.rules ?? {} })).toEqual(["R4:excerpt-cohesion"]);
  expect(ran({ rules: { "ungoverned-function": { off: reason }, "excerpt-cohesion": { off: reason } } })).toEqual([]);
});

test("a missing or empty reason, another rule's name or another key is a configuration error naming its key", () => {
  const read = (rules: unknown) => () => configuredKit(DEFAULT_CONFIG, { roots, rules });
  expect(read({ "excerpt-cohesion": { off: "" } })).toThrow(/^rules\.excerpt-cohesion\.off: /);
  expect(read({ "excerpt-cohesion": { off: "  " } })).toThrow(/^rules\.excerpt-cohesion\.off: /);
  expect(read({ "excerpt-cohesion": {} })).toThrow(/^rules\.excerpt-cohesion\.off: /);
  expect(read({ "excerpt-cohesion": null })).toThrow(/^rules\.excerpt-cohesion\.off: /);
  expect(read({ "ungoverned-function": { off: 3 } })).toThrow(/^rules\.ungoverned-function\.off: /);
  expect(read({ "function-size": { off: reason } })).toThrow(/^rules\.function-size is not a key Kit reads\./);
  expect(read({ "excerpt-cohesion": { off: reason, until: "later" } })).toThrow(/^rules\.excerpt-cohesion\.until is not a key Kit reads\./);
  expect(read(["excerpt-cohesion"])).toThrow(/^rules: /);
});

// An app whose gate records what tests ran, with a test that has no kept pass, so the rules that read it wait.
function app(rules: string) {
  const project = temporaryProjects.open("kit-rule-switch-");
  projects.push(project);
  project.write({
    "src/legacy/kept.ts": "export const kept = 1;\n",
    "oracle/text/sums.test.ts": "export {};\n",
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [], skipLibCheck: true },
      include: ["src/**/*.ts"],
    }),
    "package.json": JSON.stringify({ type: "module" }),
    "kit/config.md":
      "```yaml\nroots:\n  src: src/\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nlegacy-areas: []\nadapters: []\npackages: []\n" +
      "verify:\n  checks: []\n  tests:\n    command: run {test} {dir}\n    under: [oracle/]\n" +
      rules +
      "```\n",
    "spec/terms.md": "# Terms\n",
    "spec/text.md": "# Text\n\n- A text's parts are counted. · {#sums}\n",
  });
  const check = (...flags: string[]) =>
    runCheck({
      engineRoot: engine,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--baseline", join(project.root, "kit/debt.json"), ...flags],
      cwd: project.root,
    });
  return { project, check, debt: () => Object.keys(JSON.parse(readFileSync(join(project.root, "kit/debt.json"), "utf8"))).sort() };
}

const governed = "R4:ungoverned-function:src/core/readings/text.ts:sum";
const cohesive = "R4:excerpt-cohesion:src/core/readings/text.ts";

// The baseline an app keeps: what the check reports owed now, and a key of each rule that reads what tests ran.
async function recorded(check: ReturnType<typeof app>["check"], project: TemporaryProject): Promise<string[]> {
  project.write({ "kit/debt.json": "{}\n" });
  const report: { findings: { debtKey: string; category: string; statements?: number; calls?: number }[] } = JSON.parse(
    (await check("--report")).stdout,
  );
  const owed = report.findings
    .filter((item) => item.category === "legacy-debt" || item.category === "proof-debt")
    .map((item) => [item.debtKey, item.statements === undefined ? null : { statements: item.statements, calls: item.calls }] as const);
  const entries = [...owed, [governed, null] as const, [cohesive, null] as const];
  project.write({ "kit/debt.json": JSON.stringify(Object.fromEntries(entries), null, 2) + "\n" });
  return entries.map(([key]) => key).sort();
}

test("while the rules wait, their baseline keys are neither paid nor dropped by tightening", async () => {
  const { project, check, debt } = app("");
  const keys = await recorded(check, project);
  const waiting = await check();
  expect(waiting.stdout).toMatch(/wait for 1 tests/);
  expect(waiting.stderr).toBe("");
  expect(waiting.exitCode).toBe(0);
  const report: { stale: unknown[] } = JSON.parse((await check("--report")).stdout);
  expect(report.stale).toEqual([]);
  expect((await check("--tighten")).exitCode).toBe(0);
  expect(debt()).toEqual(keys);
}, 120_000);

test("a rule switched off has its baseline keys paid, and tightening drops them", async () => {
  const { project, check, debt } = app(`rules:\n  ungoverned-function: {off: "${reason}"}\n`);
  const keys = await recorded(check, project);
  const failed = await check();
  expect(failed.exitCode).toBe(1);
  expect(failed.stderr).toBe(`${governed}: No finding has this debt key any more. Run \`kit check --tighten\` to drop paid debt.\n`);
  expect((await check("--tighten")).exitCode).toBe(0);
  expect(debt()).toEqual(keys.filter((key) => key !== governed));
  expect((await check()).exitCode).toBe(0);
}, 120_000);

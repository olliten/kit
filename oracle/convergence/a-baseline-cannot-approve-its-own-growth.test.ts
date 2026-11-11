import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { baselineFiles, mergedBaseline } from "../../src/core/readings/baseline-files.js";
import { debtPolicyFindings } from "../../src/core/readings/debt-comparison.js";
import { type GateFinding, ratchetFindings } from "../../src/core/readings/ratchet.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const path = "src/legacy/report.ts";
const key = `R1:legacy-size:${path}`;
const obligation = (debtKey: string): GateFinding => ({
  rule: "R4", path, debtKey, fix: "Prove the contract.", category: "legacy-debt",
  status: "violation", blocking: true, limit: "",
});
const policy = { mode: "ratchet", footprint: [] } as const;

test("candidate baseline additions cannot approve new obligations even when ordinary candidate checking passes", () => {
  const approved = obligation(`R4:ungoverned-function:${path}:old`);
  const added = obligation(`R4:ungoverned-function:${path}:new`);
  const reference = { [approved.debtKey]: null };
  const candidate = { ...reference, [added.debtKey]: null };
  expect(ratchetFindings([approved, added], candidate, [], [])).toEqual([]);
  const failures = debtPolicyFindings([approved, added], candidate, reference, policy);
  expect(failures).toHaveLength(1);
  expect(failures[0]?.fix).toContain(added.debtKey);
  expect(failures[0]?.blocking).toBe(true);
});

test("paying existing debt does not buy permission to add another baseline entry", () => {
  const old = `R4:ungoverned-function:${path}:old`;
  const added = obligation(`R4:ungoverned-function:${path}:replacement`);
  const result = debtPolicyFindings([added], { [added.debtKey]: null }, { [old]: null }, { mode: "paydown", footprint: [path] });
  expect(result.some(({ debtKey }) => debtKey.includes("baseline-reference"))).toBe(true);
});

test.each([
  [{ statements: 11, calls: 3 }, { statements: 10, calls: 2 }],
  [{ statements: 10, calls: 1 }, { statements: 10, calls: 2 }],
  [{ lines: 101 }, { lines: 100 }],
  [null, { lines: 100 }],
])("candidate budget %j cannot weaken approved %j", (candidate, reference) => {
  expect(debtPolicyFindings([], { [key]: candidate }, { [key]: reference }, policy)).toHaveLength(1);
});

test("smaller budgets and changed descriptive reasons do not weaken the approved baseline", () => {
  const reference = { [key]: { statements: 10, calls: 2, reason: "split next" } };
  expect(debtPolicyFindings([], { [key]: { statements: 9, calls: 2, reason: "partly split" } }, reference, policy)).toEqual([]);
  expect(debtPolicyFindings([], {}, reference, policy)).toEqual([]);
});

test("the check rejects actual new legacy debt that a candidate added to its own baseline", async () => {
  const project = temporaryProjects.open("kit-approved-reference-");
  try {
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [],
      }, include: ["src/**/*.ts"] }),
      "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nterms: spec/terms.md\n```\n",
      "spec/terms.md": "# Terms\n",
      "src/legacy/kept.ts": "export const kept = 1;\n",
      "baseline.json": "{}",
    });
    const request = (...flags: string[]) => ({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--baseline", join(project.root, "baseline.json"), ...flags] });
    const baseline = async () => {
      const report: { readonly findings: readonly GateFinding[] } = JSON.parse((await runCheck(request("--report"))).stdout);
      return Object.fromEntries(report.findings.filter((item) => item.category === "legacy-debt").map((item) => [item.debtKey,
        item.statements === undefined ? null : { statements: item.statements, calls: item.calls }]));
    };
    const approved = await baseline();
    project.write({ "reference.json": JSON.stringify(approved), "src/legacy/added.ts": "export const added = 2;\n" });
    const selfApproved = await baseline();
    expect(Object.keys(selfApproved).some((key) => !Object.hasOwn(approved, key))).toBe(true);
    project.write({ "baseline.json": JSON.stringify(selfApproved) });
    const withoutReference = await runCheck(request());
    expect(withoutReference.exitCode, withoutReference.stderr).toBe(0);
    const rejected = await runCheck(request("--baseline-reference", join(project.root, "reference.json")));
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("baseline-reference");
    expect(rejected.stderr).toContain("src/legacy/added.ts");
    const tightened = await runCheck(request("--tighten", "--baseline-reference", join(project.root, "reference.json")));
    expect(tightened.exitCode).toBe(1);
    expect(tightened.stderr).toContain("baseline-reference");
    expect(tightened.stderr).toContain("src/legacy/added.ts");
  } finally {
    project.dispose();
  }
}, 120_000);


test.each(["file", "directory"])("one call proves the drain left in a %s baseline without approving remaining growth", async (form) => {
  const project = temporaryProjects.open("kit-proven-drain-");
  try {
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [],
      }, include: ["src/**/*.ts"] }),
      "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nterms: spec/terms.md\n```\n",
      "spec/terms.md": "# Terms\n",
      [path]: "export const kept = 1;\n",
    });
    const candidate = form === "file" ? "baseline.json" : "baseline";
    const reference = join(project.root, "reference.json");
    const request = (...flags: string[]) => ({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--baseline", join(project.root, candidate), ...flags] });
    const report: { readonly findings: readonly GateFinding[] } = JSON.parse((await runCheck(request("--report"))).stdout);
    const actual = Object.fromEntries(report.findings.filter((item) => item.category === "legacy-debt").map((item) => [item.debtKey,
      item.statements === undefined ? null : { statements: item.statements, calls: item.calls }]));
    expect(actual[key]).toEqual({ statements: 1, calls: 0 });
    const approved = { ...actual, [key]: { statements: 2, calls: 0 } };
    const ghost = "R4:ungoverned-function:src/legacy/gone.ts:gone";
    const oversized = { ...actual, [key]: { statements: 5, calls: 0 }, [ghost]: null };
    const write = (record: Record<string, unknown>) => {
      if (form === "file") project.write({ [candidate]: JSON.stringify(record) });
      else {
        project.directory(candidate);
        for (const [file, text] of baselineFiles(candidate, record)) project.write({ [file]: text });
      }
    };
    const read = (): Record<string, unknown> => form === "file"
      ? JSON.parse(readFileSync(join(project.root, candidate), "utf8"))
      : mergedBaseline(readdirSync(join(project.root, candidate)).map((name) => ({ path: name, text: readFileSync(join(project.root, candidate, name), "utf8") })));
    project.write({ "reference.json": JSON.stringify(approved) });
    write(oversized);
    const rejected = await runCheck(request("--baseline-reference", reference));
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("baseline-reference");
    const reported = await runCheck(request("--report", "--tighten", "--baseline-reference", reference));
    expect(JSON.parse(reported.stdout).policyFailures.length).toBeGreaterThan(0);
    expect(read()[key]).toEqual(oversized[key]);
    const drained = await runCheck(request("--tighten", "--baseline-reference", reference));
    expect(drained.exitCode, drained.stderr).toBe(0);
    expect(read()).toEqual(actual);
    expect((await runCheck(request("--baseline-reference", reference))).exitCode).toBe(0);

    project.write({ [path]: "export const first = 1;\nexport const second = 2;\nexport const third = 3;\n" });
    write({ ...actual, [key]: { statements: 3, calls: 0 } });
    const grown = await runCheck(request("--tighten", "--baseline-reference", reference));
    expect(grown.exitCode).toBe(1);
    expect(grown.stderr).toContain("baseline-reference");
    expect(grown.stderr).toContain("weakens the approved budget");
  } finally {
    project.dispose();
  }
}, 120_000);

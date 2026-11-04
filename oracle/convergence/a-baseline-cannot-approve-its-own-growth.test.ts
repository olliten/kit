import { join } from "node:path";
import { expect, test } from "vitest";
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
  } finally {
    project.dispose();
  }
}, 120_000);

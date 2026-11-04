import { join } from "node:path";
import { expect, test } from "vitest";
import { debtPolicyFindings, debtPolicyOf } from "../../src/core/readings/debt-comparison.js";
import type { GateFinding } from "../../src/core/readings/ratchet.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const path = "src/legacy/report.ts";
const key = `R1:legacy-size:${path}`;
const governed = `R4:ungoverned-function:${path}:report`;
const finding = (debtKey: string, measurements: { readonly statements?: number; readonly calls?: number; readonly lines?: number } = {}): GateFinding => ({
  rule: "R4", path, debtKey, fix: "Extract and prove the responsibility.", category: "legacy-debt",
  status: "violation", blocking: true, limit: "", ...measurements,
});
const policy = { mode: "paydown", footprint: [path] } as const;
const failedPaydown = (values: readonly GateFinding[]) => values.some(({ debtKey }) => debtKey === "R4:debt-paydown:kit/debt");

test("shipping mode accepts unchanged debt and migration mode requires a real reduction", () => {
  const current = finding(governed);
  const baseline = { [governed]: null };
  expect(debtPolicyFindings([current], baseline, baseline, { mode: "ratchet", footprint: [] })).toEqual([]);
  expect(failedPaydown(debtPolicyFindings([current], baseline, baseline, policy))).toBe(true);
  expect(debtPolicyFindings([], {}, baseline, policy)).toEqual([]);
});

test("deleting baseline JSON without resolving its finding earns no reduction", () => {
  expect(failedPaydown(debtPolicyFindings([finding(governed)], {}, { [governed]: null }, policy))).toBe(true);
});

test("a reduction outside the change footprint does not satisfy migration mode", () => {
  expect(failedPaydown(debtPolicyFindings([], {}, { [governed]: null }, {
    mode: "paydown", footprint: ["src/legacy/unrelated.ts"],
  }))).toBe(true);
});

test("less own logic qualifies even when composition adds delegation statements", () => {
  const reference = { [key]: { statements: 10, calls: 2 } };
  const candidate = { [key]: { statements: 10, calls: 4 } };
  expect(debtPolicyFindings([finding(key, { statements: 12, calls: 6 })], candidate, reference, policy)).toEqual([]);
});

test("fewer total statements with unchanged own logic is not a migration reduction", () => {
  const reference = { [key]: { statements: 10, calls: 2 } };
  expect(failedPaydown(debtPolicyFindings([finding(key, { statements: 9, calls: 1 })], reference, reference, policy))).toBe(true);
});

test("smaller legacy function bodies qualify, while reasons and arbitrary score fields do not", () => {
  const lines = `R2:function-size:${path}:report`;
  const reference = { [lines]: { lines: 100, reason: "split" }, [governed]: { score: 10 } };
  expect(debtPolicyFindings([finding(lines, { lines: 99 }), finding(governed)], {
    [lines]: { lines: 99, reason: "partly split" }, [governed]: { score: 9 },
  }, reference, policy)).toEqual([]);
  expect(failedPaydown(debtPolicyFindings([finding(lines, { lines: 100 }), finding(governed)], {
    [lines]: { lines: 100, reason: "rewritten" }, [governed]: { score: 0 },
  }, reference, policy))).toBe(true);
});

test("unobserved execution debt cannot be counted as paid just because its finding is absent", () => {
  const excerpt = `R4:excerpt-cohesion:${path}:spec%2Freports.md%3Aformats:format`;
  expect(failedPaydown(debtPolicyFindings([], {}, { [excerpt]: null }, policy, [`R4:excerpt-cohesion:${path}:`]))).toBe(true);
});

test("migration is a validated mode with a concrete nonempty normalized footprint", () => {
  expect(debtPolicyOf([], [])).toEqual({ mode: "ratchet", footprint: [] });
  expect(debtPolicyOf(["--debt-mode=paydown"], [path])).toEqual(policy);
  expect(debtPolicyOf(["--debt-mode", "paydown"], [path])).toEqual(policy);
  for (const args of [["--debt-mode", "unknown"], ["--debt-mode"], ["--debt-mode=paydown", "--debt-mode=ratchet"]])
    expect(() => debtPolicyOf(args, [path])).toThrow();
  for (const footprint of [[], [path, path], ["."], ["./src/a.ts"], ["src//a.ts"], ["../a.ts"], ["/a.ts"], ["src/*.ts"], "src/a.ts"])
    expect(() => debtPolicyOf(["--debt-mode=paydown"], footprint)).toThrow();
});

test("the command accepts shipping with unchanged debt and migration only after a real scoped deletion", async () => {
  const project = temporaryProjects.open("kit-migration-command-");
  try {
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [],
      }, include: ["src/**/*.ts"] }),
      "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nterms: spec/terms.md\n```\n",
      "spec/terms.md": "# Terms\n",
      [path]: "export const report = 1;\n",
      "src/legacy/kept.ts": "export const kept = 2;\n",
      "baseline.json": "{}", "footprint.json": JSON.stringify([path]),
    });
    const request = (...flags: string[]) => ({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--baseline", join(project.root, "baseline.json"), ...flags] });
    const report: { readonly findings: readonly GateFinding[] } = JSON.parse((await runCheck(request("--report"))).stdout);
    const baseline = Object.fromEntries(report.findings.filter((item) => item.category === "legacy-debt").map((item) => [item.debtKey,
      item.statements === undefined ? null : { statements: item.statements, calls: item.calls }]));
    project.write({ "baseline.json": JSON.stringify(baseline), "reference.json": JSON.stringify(baseline) });
    const flags = ["--baseline-reference", join(project.root, "reference.json"), "--debt-mode", "paydown", "--footprint", join(project.root, "footprint.json")];
    const shipping = await runCheck(request("--baseline-reference", join(project.root, "reference.json")));
    expect(shipping.exitCode, shipping.stderr).toBe(0);
    const unchanged = await runCheck(request(...flags));
    expect(unchanged.exitCode).toBe(1);
    expect(unchanged.stderr).toContain("R4:debt-paydown:kit/debt");
    project.remove(path);
    const improved = await runCheck(request(...flags, "--tighten"));
    expect(improved.exitCode, improved.stderr).toBe(0);
    expect((await runCheck(request(...flags))).exitCode).toBe(0);
  } finally {
    project.dispose();
  }
}, 120_000);

import { readFileSync } from "node:fs";
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

const kept = "src/legacy/kept.ts";
const sizeKey = `R1:legacy-size:${kept}`;
const goneKey = "R1:type-escape:src/legacy/gone.ts:a";

function app() {
  const project = temporaryProjects.open("kit-debt-reason-");
  projects.push(project);
  project.write({
    [kept]: "export function kept(values: readonly number[]): number {\n  const count = values.length;\n  return count;\n}\n",
    "src/legacy/escape.ts": "export const escaped = (value: unknown): number => value as number;\n",
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

type Report = {
  findings: { debtKey: string; category: string; reason?: string; statements?: number; calls?: number }[];
  stale: { debtKey: string; fix: string; reason?: string }[];
};

test("reasons are optional, kept by tightening, and shown by the report in either baseline form", async () => {
  const { project, check } = app();
  const first: Report = JSON.parse((await check("kit/none.json", "--report")).stdout);
  const owed = first.findings.filter((item) => item.category === "legacy-debt" || item.category === "proof-debt");
  expect(owed.every((item) => item.reason === undefined)).toBe(true);
  expect(first.stale).toEqual([]);
  // Two entries carry a reason and the others carry none, as a first baseline's entries would. The size entry
  // records one statement more than the module holds, so it is paid until tightened.
  const record: Record<string, unknown> = Object.fromEntries(
    owed.map((item) => [item.debtKey, item.statements === undefined ? null : { statements: item.statements, calls: item.calls }]),
  );
  record[sizeKey] = { statements: 4, calls: 0, reason: "awaits placing the counter" };
  record[goneKey] = { reason: "awaits the type guard" };
  const plain = owed.find((item) => item.debtKey.startsWith("R1:type-escape:"))?.debtKey ?? "";
  expect(plain).not.toBe("");

  for (const form of ["kit/debt.json", "kit/debt"]) {
    const path = join(project.root, form);
    if (form.endsWith(".json")) project.write({ [form]: JSON.stringify(record, null, 2) + "\n" });
    else for (const [file, text] of baselineFiles(path, record)) project.write({ [file.slice(project.root.length + 1)]: text });

    const report: Report = JSON.parse((await check(form, "--report")).stdout);
    expect(report.findings.find((item) => item.debtKey === sizeKey)?.reason).toBe("awaits placing the counter");
    expect(report.findings.find((item) => item.debtKey === plain)?.reason).toBeUndefined();
    expect(report.stale.map(({ debtKey, reason }) => ({ debtKey, reason }))).toEqual([
      { debtKey: sizeKey, reason: "awaits placing the counter" },
      { debtKey: goneKey, reason: "awaits the type guard" },
    ]);
    expect((await check(form)).exitCode).toBe(1);

    expect((await check(form, "--tighten")).exitCode).toBe(0);
    const left = form.endsWith(".json") ? JSON.parse(readFileSync(path, "utf8")) : JSON.parse(readFileSync(baselineFileOf(path, kept), "utf8"));
    expect(left[sizeKey]).toEqual({ statements: 3, calls: 0, reason: "awaits placing the counter" });
    expect(left[goneKey]).toBeUndefined();
    const after: Report = JSON.parse((await check(form, "--report")).stdout);
    expect(after.findings.find((item) => item.debtKey === sizeKey)?.reason).toBe("awaits placing the counter");
    expect(after.stale).toEqual([]);
  }
}, 120_000);

test("a reason that isn't a nonempty string is refused, and an entry without one reads as before", () => {
  const read = (entry: unknown) => mergedBaseline([{ path: "kit/debt.json", text: JSON.stringify({ "R1:a:b": entry }) }]);
  expect(() => read({ reason: "" })).toThrow(/kit\/debt\.json: the reason of R1:a:b is a nonempty string/);
  expect(() => read({ reason: 3 })).toThrow(/nonempty string/);
  expect(() => read({ statements: 2, calls: 0, reason: null })).toThrow(/nonempty string/);
  expect(read(null)).toEqual({ "R1:a:b": null });
  expect(read({ statements: 2, calls: 0 })).toEqual({ "R1:a:b": { statements: 2, calls: 0 } });
  expect(read({ reason: "awaits a placed reader" })).toEqual({ "R1:a:b": { reason: "awaits a placed reader" } });
});

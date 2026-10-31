import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { configuredKit } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const engine = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };
const reason = "Its test lands in the next pull request.";

// An app with a claim no test proves yet, and a test still naming a claim's old anchor.
function app(pending: string) {
  const project = temporaryProjects.open("kit-pending-");
  projects.push(project);
  project.write({
    "src/core/readings/count.ts": "export const count = (text: string): number => text.length;\n",
    "oracle/text/sums.test.ts": 'import { count } from "../../src/core/readings/count.js";\nexport const counted = count("a");\n',
    "oracle/text/adds.test.ts": "export {};\n",
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [], skipLibCheck: true },
      include: ["src/**/*.ts", "oracle/**/*.ts"],
    }),
    "package.json": JSON.stringify({ type: "module" }),
    "kit/config.md":
      "```yaml\nroots:\n  src: [src/, oracle/]\n  spec: spec/\n  oracle: oracle/\nterms: spec/terms.md\nlegacy-areas: []\nadapters: []\npackages: []\n" +
      pending +
      "```\n",
    "kit/debt.json": "{}\n",
    "spec/terms.md": "# Terms\n\n- **count** — the length of a text.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
    "spec/text.md":
      "# Text\n\nA text is counted.\n\n## Counting\n\n- A text's characters are counted. · {#sums}\n  - Implementation: {{count}}\n\n" +
      "- A text's words are counted. · {#words}\n",
  });
  return (...flags: string[]) =>
    runCheck({
      engineRoot: engine,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--baseline", join(project.root, "kit/debt.json"), ...flags],
      cwd: project.root,
    });
}

const missing = "R3:missing-proof:spec/text.md:words";
const unknown = "R3:unknown-claim:oracle/text/adds.test.ts";
const rows = (...entries: string[]) => `pending:\n${entries.map((entry) => `  - {${entry}, reason: "${reason}"}\n`).join("")}`;

test("an undeclared missing proof and unknown claim fail as before", async () => {
  const checked = await app("")();
  expect(checked.exitCode).toBe(1);
  expect(checked.stderr.split("\n").filter(Boolean).map((line) => line.split(": ")[0])).toEqual([missing, unknown]);
}, 120_000);

test("a declared pending claim and pending test are reported as pending, one line each, and never fail", async () => {
  const check = app(rows("claim: spec/text.md:words", "test: oracle/text/adds.test.ts"));
  const checked = await check();
  expect(checked.stderr).toBe("");
  expect(checked.exitCode).toBe(0);
  expect(checked.stdout.split("\n").filter((line) => line.startsWith("Kit pending "))).toEqual([
    `Kit pending ${missing}: ${reason}`,
    `Kit pending ${unknown}: ${reason}`,
  ]);
  const report: { findings: { debtKey: string; category: string; blocking: boolean; reason?: string }[] } = JSON.parse((await check("--report")).stdout);
  expect(report.findings.filter((item) => item.category === "pending")).toEqual([
    expect.objectContaining({ debtKey: missing, blocking: false, reason }),
    expect.objectContaining({ debtKey: unknown, blocking: false, reason }),
  ]);
}, 120_000);

test("declaring one leaves the other failing", async () => {
  const checked = await app(rows("claim: spec/text.md:words"))();
  expect(checked.exitCode).toBe(1);
  expect(checked.stderr.split("\n").filter(Boolean).map((line) => line.split(": ")[0])).toEqual([unknown]);
}, 120_000);

test("a row whose finding is gone is paid and fails until it is removed", async () => {
  const checked = await app(rows("claim: spec/text.md:words", "test: oracle/text/adds.test.ts", "claim: spec/text.md:sums", "test: oracle/text/sums.test.ts"))();
  expect(checked.exitCode).toBe(1);
  expect(checked.stderr).toBe(
    "R3:paid-pending:spec/text.md:sums: This pending claim has its proof now, or names no claim: remove its row from `pending`.\n" +
      "R3:paid-pending:oracle/text/sums.test.ts: This pending test names a claim of its topic now, or is gone: remove its row from `pending`.\n",
  );
}, 120_000);

test("a malformed row is a configuration error naming its key", () => {
  const read = (pending: unknown) => () => configuredKit(DEFAULT_CONFIG, { roots, pending });
  expect(read([{ claim: "spec/text.md:words", reason }, { test: "oracle/text/adds.test.ts", reason }])().pending).toEqual([
    { claim: "spec/text.md:words", reason },
    { test: "oracle/text/adds.test.ts", reason },
  ]);
  expect(read({ "spec/text.md:words": reason })).toThrow(/^pending: /);
  expect(read(["spec/text.md:words"])).toThrow(/^pending\[0\]: /);
  expect(read([{ reason }])).toThrow(/^pending\[0\]: name a claim or a test, not neither\./);
  expect(read([{ claim: "spec/text.md:words", test: "oracle/text/adds.test.ts", reason }])).toThrow(/^pending\[0\]: name a claim or a test, not both\./);
  expect(read([{ claim: "spec/text.md", reason }])).toThrow(/^pending\[0\]\.claim: /);
  expect(read([{ claim: 3, reason }])).toThrow(/^pending\[0\]\.claim: /);
  expect(read([{ test: "", reason }])).toThrow(/^pending\[0\]\.test: /);
  expect(read([{ test: "oracle/text/adds.test.ts" }])).toThrow(/^pending\[0\]\.reason: /);
  expect(read([{ test: "oracle/text/adds.test.ts", reason: "  " }])).toThrow(/^pending\[0\]\.reason: /);
  expect(read([{ claim: "spec/text.md:words", reason }, { claim: "spec/text.md:words", reason }])).toThrow(/^pending\[1\]: repeats pending\[0\]/);
  expect(read([{ test: "oracle/text/adds.test.ts", owner: "Olli", reason }])).toThrow(/^pending\[0\]\.owner is not a key Kit reads\./);
});

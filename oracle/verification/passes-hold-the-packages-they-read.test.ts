import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runsScripts, runtimeOf, verdictKind, verdictOf } from "../../src/core/readings/verdict-reuse.js";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

type Entry = { readonly version: string; readonly resolved?: string; readonly integrity?: string };
const entry = (name: string, version: string): Entry => ({
  version,
  resolved: `https://registry.example/${name}/-/${name}-${version}.tgz`,
  integrity: `sha512-${name}-${version}`,
});
const PACKAGES: Readonly<Record<string, Entry>> = {
  "node_modules/used": entry("used", "1.0.0"),
  "node_modules/used/node_modules/inner": entry("inner", "1.0.0"),
  "node_modules/@scope/pkg": entry("pkg", "1.0.0"),
  "node_modules/unused": entry("unused", "1.0.0"),
  "node_modules/kit": entry("kit", "1.0.0"),
};
const lockfile = (packages: Readonly<Record<string, Entry>>): string =>
  JSON.stringify({ name: "app", lockfileVersion: 3, requires: true, packages: { "": { name: "app" }, ...packages } }, null, 2);
const manifest = (scripts: Readonly<Record<string, string>>): string => JSON.stringify({ name: "app", type: "module", scripts });

// An app with installed packages: one its test uses, which uses a nested and a scoped one, one nothing uses, and
// the Kit that runs the gate, whose code one check loads. Its checks: one through an npm script, one loading Kit.
function app() {
  const project = temporaryProjects.open("kit-packages-");
  projects.push(project);
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "kit/config.md":
      "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: lint, command: npm run --silent lint}\n" +
      "    - {id: kit-check, command: node kit-check.mjs}\n  tests:\n    command: node {test}\n    under: tests/\n```\n",
    "package.json": manifest({ lint: "node lint.mjs" }),
    "package-lock.json": lockfile(PACKAGES),
    "lint.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("data.txt");\n',
    "data.txt": "1",
    "kit-check.mjs": 'import { tool } from "kit/src/tool.mjs";\nif (tool !== 1) process.exit(1);\n',
    "tests/used.test.mjs": 'import { used } from "used";\nif (used() !== 3) process.exit(1);\n',
    "tests/plain.test.mjs": 'import { readFileSync } from "node:fs";\nreadFileSync("a.txt");\n',
    "a.txt": "a",
    "node_modules/used/package.json": JSON.stringify({ name: "used", type: "module", main: "index.js" }),
    "node_modules/used/index.js": 'import { inner } from "inner";\nimport { pkg } from "@scope/pkg";\nexport const used = () => inner + pkg;\n',
    "node_modules/used/node_modules/inner/package.json": JSON.stringify({ name: "inner", type: "module", main: "index.js" }),
    "node_modules/used/node_modules/inner/index.js": "export const inner = 1;\n",
    "node_modules/@scope/pkg/package.json": JSON.stringify({ name: "@scope/pkg", type: "module", main: "index.js" }),
    "node_modules/@scope/pkg/index.js": "export const pkg = 2;\n",
    "node_modules/unused/package.json": JSON.stringify({ name: "unused", type: "module", main: "index.js" }),
    "node_modules/unused/index.js": "export const unused = 0;\n",
    // The Kit installed among the app's packages: a file the check loads, and one nothing loads.
    "node_modules/kit/package.json": JSON.stringify({ name: "kit", type: "module" }),
    "node_modules/kit/src/tool.mjs": "export const tool = 1;\n",
    "node_modules/kit/src/other.mjs": "export const other = 1;\n",
  });
  const root = project.root;
  const engineRoot = join(root, "node_modules/kit");
  const verify = (...flags: string[]) => runVerify({ engineRoot, args: ["--root", root, "--config", join(root, "kit/config.md"), ...flags], cwd: root });
  const plan = async () => (await verify("--plan")).stdout.split("\n").filter(Boolean);
  // The keys a check's kept pass holds, under the kind it is kept under now.
  const held = (id: string, line: string): Record<string, string> => {
    const kind = verdictKind(id, line, runtimeOf(line, toolchain.runtime(root), toolchain.scripts(root)));
    const [pass] = evidenceStore.entries(evidenceStore.directory(root), kind).flatMap((text) => verdictOf(text) ?? []);
    return pass?.states ?? {};
  };
  return { project, root, engineRoot, verify, plan, held };
}
const summary = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf("Kit verify ") + 11));
const ALL = ["reuse lint", "reuse kit-check", "reuse test:tests/plain.test.mjs", "reuse test:tests/used.test.mjs"];
const running = (...ids: string[]) => ALL.map((line) => (ids.some((id) => line === `reuse ${id}`) ? line.replace("reuse", "run") : line));

test("a check's command runs package scripts through a package manager or node --run, and npx runs none", () => {
  for (const line of ["npm run lint", "npm test", "npm run-script lint", "npm start", "yarn lint", "pnpm test", "bun run x", "node --run lint", "a && npm test"])
    expect(runsScripts(line), line).toBe(true);
  for (const line of ["npx vitest run {test}", "node {test}", "node scripts/npm.mjs", "npx tsc --noEmit"]) expect(runsScripts(line), line).toBe(false);
});

test("a script edit reruns only the checks that run scripts, and the rest of the manifest is the runtime", async () => {
  const { project, verify, plan } = app();
  const first = await verify();
  expect(first.stderr).toBe("");
  expect(summary(first.stdout)).toMatchObject({ ran: 4, failed: 0, recorded: 4 });
  expect(await plan()).toEqual(ALL);
  project.write({ "package.json": manifest({ lint: "node lint.mjs", other: "node other.mjs" }) });
  expect(await plan()).toEqual(running("lint"));
  expect(summary((await verify()).stdout)).toMatchObject({ ran: 1, reused: 3 });
  // A field a loader reads, outside the scripts, is the runtime of every check.
  project.write({ "package.json": JSON.stringify({ name: "app", type: "module", imports: { "#x": "./a.txt" }, scripts: { lint: "node lint.mjs", other: "node other.mjs" } }) });
  expect(await plan()).toEqual(running("lint", "kit-check", "test:tests/plain.test.mjs", "test:tests/used.test.mjs"));
}, 120_000);

test("a pass holds the lockfile entries of the packages its run used, nested and scoped ones too, and no others", async () => {
  const { project, verify, plan, held } = app();
  expect((await verify()).exitCode).toBe(0);
  const states = held("test:tests/used.test.mjs", "node tests/used.test.mjs");
  expect(Object.keys(states).filter((key) => key.startsWith("#package:"))).toEqual(
    expect.arrayContaining(["#package:node_modules/used", "#package:node_modules/used/node_modules/inner", "#package:node_modules/@scope/pkg"]),
  );
  expect(states["#package:node_modules/used"]).toContain("1.0.0");
  expect(Object.keys(states)).not.toContain("#package:node_modules/unused");
  expect(Object.keys(states).some((key) => key.includes("node_modules/used/index.js"))).toBe(false);
  expect(Object.keys(held("test:tests/plain.test.mjs", "node tests/plain.test.mjs")).filter((key) => key.includes("node_modules"))).toEqual([]);

  // A package nothing used changes: every pass holds.
  project.write({ "package-lock.json": lockfile({ ...PACKAGES, "node_modules/unused": entry("unused", "2.0.0") }) });
  expect(await plan()).toEqual(ALL);
  // The nested one, the scoped one, the one the test imports: the test that used it runs again, alone.
  for (const path of ["node_modules/used/node_modules/inner", "node_modules/@scope/pkg", "node_modules/used"]) {
    project.write({ "package-lock.json": lockfile({ ...PACKAGES, [path]: entry(path, "2.0.0") }) });
    expect(await plan(), path).toEqual(running("test:tests/used.test.mjs"));
  }
  // A package newly installed where the test's import looked for it is seen too, by its entry no longer absent.
  project.write({ "package-lock.json": lockfile({ ...PACKAGES, "tests/node_modules/used": entry("used", "3.0.0") }) });
  expect(await plan()).toEqual(running("test:tests/used.test.mjs"));
}, 120_000);

test("with no lockfile, or one without a packages map, the runtime holds the lockfile whole", async () => {
  const { project, root, verify, plan, held } = app();
  project.remove("package-lock.json");
  expect(toolchain.packages(root)).toBeUndefined();
  expect((await verify()).exitCode).toBe(0);
  expect(held("test:tests/used.test.mjs", "node tests/used.test.mjs")["#package:node_modules/used"]).toBe("unlocked");
  expect(await plan()).toEqual(ALL);
  // An older lockfile, with its dependencies but no packages map: any change to it reruns every check.
  const old = (version: string) => JSON.stringify({ name: "app", lockfileVersion: 1, dependencies: { unused: { version } } });
  project.write({ "package-lock.json": old("1.0.0") });
  expect(toolchain.packages(root)).toBeUndefined();
  expect(await plan()).toEqual(running("lint", "kit-check", "test:tests/plain.test.mjs", "test:tests/used.test.mjs"));
  expect((await verify()).exitCode).toBe(0);
  expect(await plan()).toEqual(ALL);
  project.write({ "package-lock.json": old("2.0.0") });
  expect(await plan()).toEqual(running("lint", "kit-check", "test:tests/plain.test.mjs", "test:tests/used.test.mjs"));
}, 120_000);

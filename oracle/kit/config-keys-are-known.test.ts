import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { configuredKit, kitConfig } from "../../src/core/compositions/kit-configuration.js";
import { DEFAULT_CONFIG } from "../../src/core/primitives/default-config.js";
import { configIssues } from "../../src/core/readings/config-schema.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { readConfig } from "../../src/substrate/compositions/read-config.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const KIT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const roots = { src: "src/", spec: "spec/", oracle: "oracle/" };
const adapter = { module: "src/substrate/adapters/clock", export: "clock", capability: "clock", kind: "external", zones: ["substrate"] };
const keys = (declaration: Record<string, unknown>) => configIssues(declaration).map((issue) => issue.key);

test("Kit's own config declares only keys Kit reads", () => {
  expect(configIssues(kitConfig(readFileSync(join(KIT, "self-config.md"), "utf8")))).toEqual([]);
});

test("an unknown key at any level is named by its full path", () => {
  expect(keys({ roots, zones: { core: "src/core/" } })).toEqual(["zones"]);
  expect(keys({ roots: { ...roots, code: "lib/" } })).toEqual(["roots.code"]);
  expect(keys({ roots, runs: { record: "kit/runs.json", each: "x {test} {dir}", extra: 1 } })).toEqual(["runs.extra"]);
  expect(keys({ roots, adapters: [adapter, adapter, adapter, { ...adapter, globalz: ["process"] }] })).toEqual([
    "adapters[3].globalz",
  ]);
  expect(keys({ roots, adapters: [{ ...adapter, contract: { types: "Clock" } }] })).toEqual(["adapters[0].contract.types"]);
  expect(keys({ roots, packages: [{ name: "x", capabilities: [], exports: [] }] })).toEqual(["packages[0].exports"]);
  expect(keys({ roots, "legacy-zones": [{ zone: "core", root: "old/", zones: [] }] })).toEqual(["legacy-zones[0].zones"]);
  expect(keys({ roots, "dependency-exclusions": [{ from: "a", to: "b", imports: "all", reach: "direct", why: "" }] })).toEqual([
    "dependency-exclusions[0].why",
  ]);
});

test("every unknown key is reported at once, before any section is read", () => {
  const read = () => configuredKit(DEFAULT_CONFIG, { roots, zones: {}, tests: {}, adapters: [{ ...adapter, accepts: [] }] });
  expect(read).toThrow(/adapters\[0\]\.accepts is not a key Kit reads\.\ntests is not a key Kit reads\.\nzones is not a key Kit reads\./);
});

test("app names the app, and must be a name", () => {
  expect(configuredKit(DEFAULT_CONFIG, { app: "kit", roots }).app).toBe("kit");
  expect(configuredKit(DEFAULT_CONFIG, { roots }).app).toBeUndefined();
  expect(() => configuredKit(DEFAULT_CONFIG, { app: " ", roots })).toThrow(/app/);
});

test("a section's error names its row, and a legacy zone row is a root or files, never both", () => {
  expect(() => configuredKit(DEFAULT_CONFIG, { roots, adapters: [adapter, { ...adapter, kind: "maybe" }] })).toThrow(/^adapters\[1\]: /);
  expect(() => configuredKit(DEFAULT_CONFIG, { roots, "legacy-zones": [{ zone: "core", root: "old/", files: ["old/a.ts"] }] })).toThrow(
    /^legacy-zones\[0\]: /,
  );
  expect(() => configuredKit(DEFAULT_CONFIG, { roots, runs: { record: "../runs.json", each: "x {test} {dir}" } })).toThrow(/inside the app/);
});

const project = temporaryProjects.open("kit-config-");
afterAll(() => project.dispose());

test("a config error answers the command with the file and its issues, never a stack", async () => {
  project.write({
    "kit/bad.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nadapters:\n  - {module: a, export: a, capability: c, kind: external, zones: [substrate], globalz: [process]}\n```\n",
    "kit/broken.md": "```yaml\nroots: {src: src/\n```\n",
    "kit/good.md": "```yaml\napp: shop\nroots: {src: src/, spec: spec/, oracle: oracle/}\n```\n",
    "kit/legacy.json": "{}\n",
  });
  const bad = join(project.root, "kit/bad.md");
  expect(readConfig(join(project.root, "kit/missing.md"))).toMatchObject({ failure: { stdout: "", exitCode: 1 } });
  expect(readConfig(bad)).toEqual({
    failure: { stdout: "", stderr: expect.stringMatching(/^Kit config .*bad\.md: adapters\[0\]\.globalz is not a key Kit reads\./), exitCode: 1 },
  });
  expect(readConfig(join(project.root, "kit/broken.md"))).toMatchObject({
    failure: { stderr: expect.stringMatching(/broken\.md: .*\(\d+:\d+\)/), exitCode: 1 },
  });
  expect(readConfig(join(project.root, "kit/good.md"))).toMatchObject({ config: { app: "shop", srcRoot: "src" } });
  const checked = await runCheck({
    engineRoot: KIT,
    args: ["--root", project.root, "--config", bad, "--baseline", join(project.root, "kit/legacy.json")],
    cwd: project.root,
  });
  expect(checked).toEqual({ stdout: "", stderr: expect.stringContaining("adapters[0].globalz"), exitCode: 1 });
});

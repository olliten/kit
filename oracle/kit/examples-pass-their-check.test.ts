import { join } from "node:path";
import { expect, test } from "vitest";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { processes } from "../../src/substrate/adapters/processes.js";
import { runCheck } from "../../src/substrate/compositions/check-run.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";
import { authoredExample } from "../substrate/compositions/authored-example.js";

const engine = join(import.meta.dirname, "../..");
const apps = textFiles
  .entries(join(engine, "examples"))
  .filter((entry) => entry.directory)
  .map((entry) => entry.name);

test("Kit ships at least one example app", () => {
  expect(apps.length).toBeGreaterThan(0);
});

test.each(apps)("the %s example declares an empty baseline and passes its check", async (app) => {
  const authoredRoot = join(engine, "examples", app);
  const inputs = authoredExample(authoredRoot);
  const originalEntries = textFiles.entries(authoredRoot);
  const project = temporaryProjects.open("kit-verified-example-");
  try {
    project.write(Object.fromEntries(Object.entries(inputs).map(([path, text]) => [`examples/${app}/${path}`, text])));
    const initialized = processes.run("git", ["init", "--quiet"], project.root);
    expect(initialized.status, initialized.stderr).toBe(0);
    project.link(join(engine, "scripts"), "scripts");
    project.link(join(engine, "node_modules"), "node_modules");
    const root = join(project.root, "examples", app);
    const baseline = join(root, "kit/debt/legacy.json");
    expect(JSON.parse(textFiles.read(baseline))).toEqual({});
    const request = {
      engineRoot: engine,
      args: ["--root", root, "--config", join(root, "kit/config.md"), "--baseline", baseline],
      cwd: engine,
    };
    const qualified = await runVerify(request);
    expect(qualified.exitCode, qualified.stdout + qualified.stderr).toBe(0);
    const result = await runCheck(request);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('"counts":{}');
    expect(textFiles.entries(authoredRoot)).toEqual(originalEntries);
    expect(authoredExample(authoredRoot)).toEqual(inputs);
  } finally { project.dispose(); }
}, 120_000);

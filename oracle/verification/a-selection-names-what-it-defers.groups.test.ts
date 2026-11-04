import { join } from "node:path";
import { expect, test } from "vitest";
import { discoveryIdentity } from "../../src/core/readings/verification-selection.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";
import {
  DEFERRED_TESTS as initial, DEFERRED_BROWSER as browser, DEFERRED_SELECTED as selected,
  DEFERRED_CONFIG as config, deferredGroupFixture as files,
} from "../core/readings/deferred-group-fixture.js";

test.each([["--defer-group", "browser"], ["--defer-group=browser"]])(
  "group deferral %j runs all other groups and every static check, while fresh full verification still finds the browser failure",
  async (...flags) => {
    const project = temporaryProjects.open("kit-deferred-group-");
    try {
      project.write(files());
      const verify = (...options: string[]) => runVerify({
        engineRoot: project.root, cwd: project.root,
        args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), ...options],
      });
      const result = await verify(...flags);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("passed integrity");
      expect(result.stdout).toContain("passed after");
      expect(result.stdout).toContain("Kit verify null\nKit selection ");
      const summary = JSON.parse(result.stdout.split("Kit selection ")[1] ?? "null");
      expect(summary).toMatchObject({
        scope: "selected", selectionKind: "deferred-groups", deferredGroups: ["browser"],
        policy: "deferred-group/browser/1", discovery: discoveryIdentity(initial),
        discovered: initial.length, selected, deferred: [browser], failed: 0, unassigned: 0,
      });
      expect([...summary.selected, ...summary.deferred].sort()).toEqual(initial);
      expect(JSON.parse(textFiles.read(join(project.root, "after-evidence.json")))).toEqual(selected);
      for (const name of ["headless", "third", "unnamed"])
        expect(textFiles.read(join(project.root, `${name}-executed.txt`))).toBe("yes");
      expect(textFiles.exists(join(project.root, "browser-executed.txt"))).toBe(false);

      project.write({ "tests/new.test.mjs": "process.exit(0);\n" });
      const expanded = await verify(...flags);
      expect(expanded.exitCode).toBe(0);
      expect(JSON.parse(expanded.stdout.split("Kit selection ")[1] ?? "null")).toMatchObject({
        discovered: initial.length + 1, selected: [...selected, "tests/new.test.mjs"].sort(), deferred: [browser],
      });

      const full = await verify("--fresh");
      expect(full.exitCode).toBe(1);
      expect(full.stdout).toContain(`failed test:${browser}`);
      expect(full.stdout).not.toContain("Kit selection ");
      const exhaustive = JSON.parse(full.stdout.split("Kit verify ")[1] ?? "null");
      expect(exhaustive).toMatchObject({ scope: "all", deferred: [], reused: 0, failed: 1 });
      expect(exhaustive.selectionKind).toBeUndefined();
      expect(exhaustive.deferredGroups).toBeUndefined();
      expect(textFiles.read(join(project.root, "browser-executed.txt"))).toBe("yes");
    } finally { project.dispose(); }
  }, 120_000,
);

test("deferred groups do not forgive failed static or after-test checks", async () => {
  const project = temporaryProjects.open("kit-deferred-static-");
  try {
    project.write(files());
    const verify = () => runVerify({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--defer-group", "browser"] });
    project.write({ "integrity.txt": "bad" });
    const failed = await verify();
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toContain("failed integrity");
    project.write({ "integrity.txt": "good", "static.mjs": "if(process.argv[2]==='after') process.exit(12);\n" });
    const after = await verify();
    expect(after.exitCode).toBe(1);
    expect(after.stdout).toContain("failed after");
  } finally { project.dispose(); }
}, 120_000);

test.each([
  ["--defer-group"], ["--defer-group="], ["--defer-group", "--fresh"], ["--defer-group", "unknown"],
  ["--defer-group", "browser", "--defer-group", "browser"],
  ["--defer-group=browser", "--defer-group=browser"],
  ["--defer-group", "browser", "--defer-group=browser"],
  ["--defer-group", "browser", "--selection", "selection.json"],
  ["--defer-group=browser", "--selection=selection.json"],
])("malformed or conflicting group selectors %j cannot start verification", async (...flags) => {
  const project = temporaryProjects.open("kit-deferred-invalid-");
  try {
    project.write({ ...files(), "selection.json": JSON.stringify({
      version: 1, discovery: discoveryIdentity(initial), policy: "manual-empty", tests: [],
    }) });
    const result = await runVerify({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), ...flags] });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/defer-group|selection/);
    expect(result.stdout).not.toContain("passed ");
    expect(textFiles.exists(join(project.root, "headless-executed.txt"))).toBe(false);
  } finally { project.dispose(); }
});

test("an unassigned discovered test still rejects group deferral and its plan", async () => {
  const project = temporaryProjects.open("kit-deferred-unassigned-");
  try {
    project.write({ ...files(), "kit/config.md": config.replace("reaching: [lib/browser]", "reaching: [lib/missing]")
      .replace("under: tests/}\n", "under: absent/}\n") });
    for (const flags of [[], ["--plan"]]) {
      const result = await runVerify({ engineRoot: project.root, cwd: project.root,
        args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--defer-group", "browser", ...flags] });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("unassigned test:tests/browser.test.mjs");
      expect(result.stdout).toContain("unassigned test:tests/headless.test.mjs");
    }
  } finally { project.dispose(); }
}, 120_000);

test("a caller's manual-selection policy cannot forge SDK-derived group-deferral metadata", async () => {
  const project = temporaryProjects.open("kit-deferred-forged-");
  try {
    project.write({ ...files(), "selection.json": JSON.stringify({
      version: 1, discovery: discoveryIdentity(initial), policy: "deferred-group/browser/1", tests: selected,
    }) });
    const result = await runVerify({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--selection", "selection.json"] });
    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout.split("Kit selection ")[1] ?? "null");
    expect(summary.selectionKind).toBeUndefined();
    expect(summary.deferredGroups).toBeUndefined();
  } finally { project.dispose(); }
}, 120_000);

test("an empty deferred membership still reports selected verification, never an exhaustive pass", async () => {
  const project = temporaryProjects.open("kit-deferred-empty-");
  try {
    project.write(files());
    project.remove(browser);
    const result = await runVerify({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--defer-group", "browser"] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Kit verify null\nKit selection ");
    expect(JSON.parse(result.stdout.split("Kit selection ")[1] ?? "null")).toMatchObject({
      scope: "selected", selectionKind: "deferred-groups", deferredGroups: ["browser"], selected, deferred: [],
    });
  } finally { project.dispose(); }
}, 120_000);

test("group deferral is generic and does not implicitly suppress browser execution", async () => {
  const project = temporaryProjects.open("kit-deferred-another-group-");
  try {
    project.write({ ...files(), "kit/config.md": config.replace("id: third", "id: io/slow"),
      [browser]: "import '../lib/relay.mjs'; process.exit(0);\n" });
    const result = await runVerify({ engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--defer-group", "io/slow"] });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.split("Kit selection ")[1] ?? "null")).toMatchObject({
      selectionKind: "deferred-groups", deferredGroups: ["io/slow"], policy: "deferred-group/io%2Fslow/1",
      selected: initial.filter((path) => path !== "extra/third.test.mjs"), deferred: ["extra/third.test.mjs"],
    });
    expect(textFiles.read(join(project.root, "browser-executed.txt"))).toBe("yes");
    expect(textFiles.exists(join(project.root, "third-executed.txt"))).toBe(false);
  } finally { project.dispose(); }
}, 120_000);

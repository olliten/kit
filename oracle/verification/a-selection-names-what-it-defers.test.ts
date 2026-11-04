import { join } from "node:path";
import { expect, test } from "vitest";
import { discoveryIdentity, verificationSelection } from "../../src/core/readings/verification-selection.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const discovered = ["tests/a.test.mjs", "tests/b.test.mjs"];
const select = (tests: readonly string[]) => ({ version: 1, discovery: discoveryIdentity(discovered), policy: "staging/1", tests });

test("selection partitions complete discovery, while no selection retains exhaustive verification", () => {
  expect(discoveryIdentity([...discovered].reverse())).toBe(discoveryIdentity(discovered));
  expect(discoveryIdentity([...discovered, discovered[0] ?? ""])).toBe(discoveryIdentity(discovered));
  expect(verificationSelection(select([discovered[0] ?? ""]), discovered)).toEqual({
    scope: "selected", discovery: discoveryIdentity(discovered), policy: "staging/1",
    selected: ["tests/a.test.mjs"], deferred: ["tests/b.test.mjs"],
  });
  expect(verificationSelection(undefined, discovered)).toMatchObject({ scope: "all", selected: discovered, deferred: [] });
});

test.each([
  null,
  { ...select([]), version: 2 },
  { ...select([]), discovery: "stale" },
  { ...select([]), policy: "" },
  { ...select([]), tests: ["tests/unknown.test.mjs"] },
  { ...select([]), tests: ["tests/a.test.mjs", "tests/a.test.mjs"] },
  { ...select([]), tests: ["../outside.test.mjs"] },
  { ...select([]), tests: "tests/a.test.mjs" },
])("invalid or stale selection %j is refused", (input) => {
  expect(() => verificationSelection(input, discovered)).toThrow();
});

test("a newly discovered test invalidates an old selection instead of silently omitting it", () => {
  expect(() => verificationSelection(select(discovered), [...discovered, "tests/new.test.mjs"])).toThrow();
});

test("selected verification keeps whole-tree checks and reports deferred tests apart from exhaustive evidence", async () => {
  const project = temporaryProjects.open("kit-selection-");
  try {
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ type: "module" }),
      "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: integrity, command: node integrity.mjs}\n  tests:\n    command: node {test}\n    under: tests/\n```\n",
      "integrity.mjs": 'import { readFileSync } from "node:fs";\nif (readFileSync("integrity.txt", "utf8") !== "good") process.exit(9);\n',
      "integrity.txt": "good",
      "tests/a.test.mjs": "process.exit(0);\n",
      "tests/b.test.mjs": "process.exit(17);\n",
      "selection.json": JSON.stringify(select(["tests/a.test.mjs"])),
    });
    const request = (...flags: string[]) => ({
      engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), ...flags],
    });
    const selected = await runVerify(request("--selection", join(project.root, "selection.json")));
    expect(selected.exitCode).toBe(0);
    expect(selected.stdout).toContain("passed integrity");
    expect(selected.stdout).toContain("passed test:tests/a.test.mjs");
    expect(selected.stdout).toContain("Kit verify null\nKit selection ");
    let legacySummary: unknown = { ran: 100, failed: 0 };
    for (const line of selected.stdout.split("\n"))
      if (line.startsWith("Kit verify ")) legacySummary = JSON.parse(line.slice("Kit verify ".length));
    expect(legacySummary).toBeNull();
    expect(selected.stdout).not.toContain("passed test:tests/b.test.mjs");
    expect(JSON.parse(selected.stdout.split("Kit selection ")[1] ?? "{}")).toMatchObject({ scope: "selected", deferred: ["tests/b.test.mjs"] });
    expect((await runVerify(request())).exitCode).toBe(1);
    project.write({ "integrity.txt": "bad" });
    const failed = await runVerify(request("--selection", join(project.root, "selection.json")));
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toContain("failed integrity");
  } finally {
    project.dispose();
  }
}, 120_000);

test("a deferred test without an execution group still fails selected execution and planning", async () => {
  const project = temporaryProjects.open("kit-selection-unassigned-");
  try {
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks: []\n  tests:\n    command: node {test}\n    under: tests/\n    reaching: [src/missing.ts]\n```\n",
      "tests/a.test.mjs": "process.exit(0);\n",
      "tests/b.test.mjs": "process.exit(0);\n",
      "selection.json": JSON.stringify(select([])),
    });
    const request = (...flags: string[]) => ({
      engineRoot: project.root, cwd: project.root,
      args: ["--root", project.root, "--config", join(project.root, "kit/config.md"), "--selection", join(project.root, "selection.json"), ...flags],
    });
    for (const flags of [[], ["--plan"]]) {
      const result = await runVerify(request(...flags));
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("unassigned test:tests/a.test.mjs");
      expect(result.stdout).toContain("unassigned test:tests/b.test.mjs");
    }
  } finally {
    project.dispose();
  }
}, 120_000);

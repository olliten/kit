import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { sharedRefs } from "../../src/core/readings/shared-passes.js";
import { calendar } from "../../src/substrate/adapters/calendar.js";
import { processes } from "../../src/substrate/adapters/processes.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.dispose();
});

const PREFIX = "refs/kit-passes";
// One more test than a chunk holds, so the last runs in a chunk of its own.
const CHUNK = 64;

function git(cwd: string, ...args: string[]): string {
  const result = processes.run("git", args, cwd);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

test("a run stopped after a chunk has already shared that chunk's passes", async () => {
  const project = temporaryProjects.open("kit-share-chunks-");
  projects.push(project);
  const origin = join(project.root, "origin.git");
  const root = join(project.root, "lane");
  git(project.root, "init", "--quiet", "--bare", origin);
  const firsts = Object.fromEntries(
    Array.from({ length: CHUNK }, (_, index) => [`lane/tests/a${String(index).padStart(2, "0")}.test.mjs`, "export {};\n"]),
  );
  project.write({
    "lane/kit/config.md": `\`\`\`yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  share: ${PREFIX}/\n  capacity: 1\n  checks: []\n  tests:\n    command: node {test}\n    under: tests/\n\`\`\`\n`,
    ...firsts,
  });
  git(root, "init", "--quiet");
  git(root, "remote", "add", "origin", origin);
  const [today] = sharedRefs(PREFIX, toolchain.runtime(root), calendar.now());
  // With one command at a time, the last test starts once the first chunk has ended. It runs in the second chunk:
  // it fails unless today's ref on origin already holds the first chunk's
  // passes, as it would show to another clone if the run were stopped here.
  project.write({
    "lane/tests/z.test.mjs":
      'import { execFileSync } from "node:child_process";\n' +
      `const held = execFileSync("git", ["ls-tree", "-r", "--name-only", ${JSON.stringify(today)}], { cwd: ${JSON.stringify(origin)}, encoding: "utf8" });\n` +
      `if (held.split("\\n").filter(Boolean).length < ${CHUNK}) process.exit(1);\n`,
  });
  const result = await runVerify({ engineRoot: root, args: ["--root", root, "--config", join(root, "kit/config.md")], cwd: root });
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.slice(result.stdout.indexOf("Kit verify ") + 11))).toMatchObject({ ran: CHUNK + 1, shared: { published: CHUNK + 1 } });
  expect(git(origin, "rev-list", "--count", today)).toBe("2");
}, 300_000);

import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";
import { type TemporaryProject, temporaryProjects } from "../substrate/adapters/temporary-project.js";

const projects: TemporaryProject[] = [];
afterEach(() => { for (const project of projects.splice(0)) project.dispose(); });

test("the recorder is added to the options the caller's environment gives Node, not put in their place", async () => {
  const project = temporaryProjects.open("kit-reads-");
  projects.push(project);
  project.write({
    ".git/HEAD": "ref: refs/heads/main\n",
    "kit/config.md": "```yaml\nroots: {src: src/, spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: options, command: node options.mjs}\n```\n",
    "options.mjs": 'if (!process.env.NODE_OPTIONS.includes("--no-deprecation")) process.exit(1);\n',
  });
  // `kit verify` runs in a process of its own whose environment gives Node an option.
  const launcher = new URL("../../scripts/kit-verify.mjs", import.meta.url).pathname;
  const [result] = await processes.shells(
    [{ line: `node ${launcher} --root ${project.root} --config ${join(project.root, "kit/config.md")}`, env: { NODE_OPTIONS: "--no-deprecation", KIT_READS: "", KIT_ROOT: "" } }],
    project.root,
  );
  expect(result?.stderr).toBe("");
  expect(result?.status).toBe(0);
}, 60_000);

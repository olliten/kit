import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";
import { proofRunner } from "../../src/substrate/adapters/proof-runner.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const options = ["--pool=forks", "--poolOptions.forks.isolate=true", "--poolOptions.forks.maxForks=1", "--poolOptions.forks.minForks=1"];

test("the native runner executes the selected proof without discovering app config, workspaces, environment or PostCSS", () => {
  const project = temporaryProjects.open("kit-proof-runner-");
  try {
    project.link(fileURLToPath(new URL("../../node_modules", import.meta.url)), "node_modules");
    project.write({
      "package.json": JSON.stringify({ type: "module", workspaces: ["apps/*"], postcss: { plugins: { "missing-plugin-that-must-not-load": {} } } }),
      "vitest.config.mjs": "throw new Error('Application config must not load.');\n",
      "vitest.workspace.mjs": "throw new Error('Application workspace must not load.');\n",
      "postcss.config.mjs": "throw new Error('PostCSS discovery must not load.');\n",
      ".env": "KIT_PROOF_FIXTURE_LEAK_X=loaded\n",
      "apps/hidden/hidden.test.mjs": "throw new Error('A discovered app must not load.');\n",
      "proof.test.mjs": "import { expect, test } from 'vitest';\ntest('isolated', () => { expect(process.env.KIT_PROOF_FIXTURE_LEAK_X).toBeUndefined(); expect(1 + 2).toBe(3); });\n",
    });
    const result = processes.run(processes.node(), [proofRunner.location, "run", "proof.test.mjs", ...options], project.root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Test Files\s+1 passed/);
    project.write({ "proof.test.mjs": "import { expect, test } from 'vitest';\ntest('failed', () => { expect(1 + 2).toBe(4); });\n" });
    const failed = processes.run(processes.node(), [proofRunner.location, "run", "proof.test.mjs", ...options], project.root);
    expect(failed.status).toBe(1);
    expect(failed.stdout + failed.stderr).toContain("failed");
  } finally {
    project.dispose();
  }
}, 120_000);

test.each([
  { flags: ["--config", "app.config.mjs"] }, { flags: ["--workspace", "app.workspace.mjs"] },
  { flags: ["--watch"] }, { flags: ["--ui"] }, { flags: ["--browser"] },
])("application runtime request %j is rejected before starting the proof", ({ flags }) => {
  const project = temporaryProjects.open("kit-proof-runner-refusal-");
  try {
    const result = processes.run(processes.node(), [proofRunner.location, "run", ...flags], project.root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("bounded proof runner");
  } finally {
    project.dispose();
  }
});

test("unhandled proof errors make the actual runner fail", () => {
  const project = temporaryProjects.open("kit-proof-runner-unhandled-");
  try {
    project.link(fileURLToPath(new URL("../../node_modules", import.meta.url)), "node_modules");
    project.write({
      "package.json": JSON.stringify({ type: "module" }),
      "proof.test.mjs": "import { expect, test } from 'vitest';\ntest('unhandled', async () => { void Promise.reject(new Error('Unhandled fixture error')); await new Promise((resolve) => setTimeout(resolve, 20)); expect(true).toBe(true); });\n",
    });
    const result = processes.run(processes.node(), [proofRunner.location, "run", "proof.test.mjs", ...options], project.root);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("Unhandled fixture error");
  } finally {
    project.dispose();
  }
}, 120_000);

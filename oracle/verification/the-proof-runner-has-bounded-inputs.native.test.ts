import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";
import { runProof } from "../../src/substrate/compositions/proof-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const options = ["run", "proof.test.mjs", "--pool=forks", "--poolOptions.forks.isolate=true", "--poolOptions.forks.maxForks=1", "--poolOptions.forks.minForks=1"];

test("the native adapter returns actual proof outcomes without requiring the Kit CLI application", () => {
  const project = temporaryProjects.open("kit-native-proof-runner-");
  const adapter = pathToFileURL(fileURLToPath(new URL("../../src/substrate/adapters/proof-runner.ts", import.meta.url))).href;
  try {
    project.link(fileURLToPath(new URL("../../node_modules", import.meta.url)), "node_modules");
    project.write({
      "package.json": JSON.stringify({ type: "module" }),
      "driver.mjs": `import { proofRunner } from ${JSON.stringify(adapter)};\n` +
        "const status = await proofRunner.run(process.argv.slice(2), process.cwd());\nprocess.stdout.write(`adapter status:${status}\\n`);\nprocess.exitCode = status;\n",
      "proof.test.mjs": "import { expect, test } from 'vitest';\ntest('actual contract', () => { expect(2 + 3).toBe(5); });\n",
    });
    const passing = processes.run(processes.node(), ["--experimental-strip-types", "--no-warnings", join(project.root, "driver.mjs"), ...options], project.root);
    expect(passing.status, passing.stdout + passing.stderr).toBe(0);
    expect(passing.stdout).toContain("adapter status:0");
    project.write({ "proof.test.mjs": "import { expect, test } from 'vitest';\ntest('actual contract', () => { expect(2 + 3).toBe(6); });\n" });
    const failing = processes.run(processes.node(), ["--experimental-strip-types", "--no-warnings", join(project.root, "driver.mjs"), ...options], project.root);
    expect(failing.status).toBe(1);
    expect(failing.stdout).toContain("adapter status:1");
  } finally {
    project.dispose();
  }
}, 120_000);

test("the public command refuses application configuration rather than returning a successful proof response", async () => {
  const project = temporaryProjects.open("kit-proof-command-refusal-");
  try {
    await expect(runProof({ args: ["run", "--config", "application.config.mjs"], cwd: project.root })).rejects.toThrow("bounded proof runner");
  } finally {
    project.dispose();
  }
});

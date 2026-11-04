import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { discoveryIdentity } from "../../src/core/readings/verification-selection.js";
import { testLine } from "../../src/core/readings/verification-configuration.js";
import { runtimeOf, verdictKind, verdictOf } from "../../src/core/readings/verdict-reuse.js";
import { evidenceStore } from "../../src/substrate/adapters/evidence-store.js";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { toolchain } from "../../src/substrate/adapters/toolchain.js";
import { runVerify } from "../../src/substrate/compositions/verify-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

test("post-test evidence is a real cache input: identical proofs reuse the check, newly proved debt reruns and fails it", async () => {
  const project = temporaryProjects.open("kit-after-evidence-");
  const engineRoot = fileURLToPath(new URL("../..", import.meta.url));
  const module = "src/core/readings/counter.ts";
  const first = "oracle/counts/counts.first.test.ts";
  const second = "oracle/counts/counts.second.test.ts";
  const debt = `R4:ungoverned-function:${module}:two`;
  const command = "node --experimental-strip-types --no-warnings --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}";
  try {
    const loader = pathToFileURL(fileURLToPath(new URL("../../src/substrate/adapters/source-loader.mjs", import.meta.url))).href;
    project.write({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ type: "module" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        noEmit: true, allowImportingTsExtensions: true, types: [],
      }, include: ["src/**/*.ts", "oracle/**/*.ts"] }),
      "kit/config.md": "```yaml\nroots: {src: [src/, oracle/], spec: spec/, oracle: oracle/}\nverify:\n  checks:\n    - {id: contracts, command: 'node check-driver.mjs {evidence}', after: tests}\n  tests:\n" +
        `    command: ${command}\n    under: oracle/\n\`\`\`\n`,
      [module]: "export function one(): number { return 1; }\nexport function two(): number { return 2; }\n",
      [first]: "import { one } from '../../src/core/readings/counter.ts';\nif (one() !== 1) throw new Error('one returns one');\n",
      [second]: "import { two } from '../../src/core/readings/counter.ts';\nif (two() !== 2) throw new Error('two returns two');\n",
      "spec/terms.md": "# Terms\n\n- **counter** — the two counts.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
      "spec/counts.md": "# Counts\n\nReturns counts.\n\n## Values\n\n- The two counts are returned ({{counter}}). · {#counts}\n",
      "baseline.json": JSON.stringify({ [debt]: null }),
      "selection.json": JSON.stringify({ version: 1, discovery: discoveryIdentity([first, second]), policy: "staging/1", tests: [first] }),
      "observed.json": "{}",
      "check-driver.mjs": [
        `import { sourceLoader } from ${JSON.stringify(loader)};`,
        'import { readFileSync, writeFileSync } from "node:fs";',
        'const artifact = readFileSync(process.argv[2], "utf8");',
        'writeFileSync("observed.json", artifact);',
        `const { runCheck } = await sourceLoader.load(${JSON.stringify(engineRoot)}, ["src/substrate/compositions/check-run.ts"]);`,
        `const response = await runCheck({ engineRoot: ${JSON.stringify(engineRoot)}, cwd: process.cwd(),`,
        '  args: ["--root", process.cwd(), "--config", "kit/config.md", "--baseline", "baseline.json", "--evidence", process.argv[2]] });',
        'process.stdout.write(response.stdout); process.stderr.write(response.stderr); process.exitCode = response.exitCode;',
      ].join("\n"),
    });
    const request = (...flags: string[]) => ({ engineRoot, cwd: project.root, args: [
      "--root", project.root, "--config", join(project.root, "kit/config.md"), "--baseline", join(project.root, "baseline.json"), ...flags,
    ] });
    const selected = ["--selection", join(project.root, "selection.json")];
    const initial = await runVerify(request(...selected));
    expect(initial.exitCode, initial.stdout + initial.stderr).toBe(0);
    expect(initial.stdout).toContain("passed contracts");
    const artifact = JSON.parse(textFiles.read(join(project.root, "observed.json")));
    expect(Object.keys(artifact.tests)).toEqual([first]);
    expect(artifact.tests[first].verdict).not.toHaveProperty("seconds");
    const line = testLine(command, first);
    const [persisted] = evidenceStore.entries(evidenceStore.directory(project.root), verdictKind(`test:${first}`, line,
      runtimeOf(line, toolchain.runtime(project.root), toolchain.scripts(project.root)))).flatMap((entry) => verdictOf(entry) ?? []);
    expect(persisted?.seconds).toBeTypeOf("number");
    const warm = await runVerify(request(...selected));
    expect(warm.exitCode, warm.stdout + warm.stderr).toBe(0);
    expect(warm.stdout).toContain(`reused test:${first}`);
    expect(warm.stdout).toContain("reused contracts");
    const complete = await runVerify(request());
    expect(complete.stdout).toContain(`reused test:${first}`);
    expect(complete.stdout).toContain(`passed test:${second}`);
    expect(complete.stdout).toContain("failed contracts");
    expect(complete.exitCode).toBe(1);
    expect(complete.stderr).toContain(`${debt}: No finding has this debt key any more.`);
    expect(Object.keys(JSON.parse(textFiles.read(join(project.root, "observed.json"))).tests)).toEqual([first, second]);
  } finally {
    project.dispose();
  }
}, 180_000);

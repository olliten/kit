import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";
import { sourceLoader } from "../../src/substrate/adapters/source-loader.mjs";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

test("a launcher recognizes its real path and a link while another file and absent entry stay inert", () => {
  const project = temporaryProjects.open("kit-native-main-");
  try {
    project.write({ "driver.mjs": "export {};\n", "another.mjs": "export {};\n" });
    project.symlink("driver.mjs", "linked.mjs");
    const module = pathToFileURL(join(project.root, "driver.mjs")).href;
    expect(sourceLoader.isMain(module, join(project.root, "driver.mjs"))).toBe(true);
    expect(sourceLoader.isMain(module, join(project.root, "linked.mjs"))).toBe(true);
    expect(sourceLoader.isMain(module, join(project.root, "another.mjs"))).toBe(false);
    expect(sourceLoader.isMain(module, undefined)).toBe(false);
  } finally {
    project.dispose();
  }
});

test("the native loader hands a fixture command its root, arguments, directory and input and preserves its response", () => {
  const project = temporaryProjects.open("kit-native-command-");
  try {
    const loader = new URL("../../src/substrate/adapters/source-loader.mjs", import.meta.url).href;
    const terminal = fileURLToPath(new URL("../../src/substrate/adapters/terminal-input.ts", import.meta.url));
    project.write({
      "package.json": JSON.stringify({ type: "module" }),
      "scripts/driver.mjs": `import { sourceLoader } from ${JSON.stringify(loader)};\nawait sourceLoader.run(import.meta.url, 'src/echo.ts', 'echo');\n`,
      "src/echo.ts": "export async function echo(request: { engineRoot: string; args: readonly string[]; cwd: string }, input: { read(): string }) {\n" +
        "  return { stdout: JSON.stringify({ ...request, input: input.read() }) + '\\n', stderr: 'fixture warning\\n', exitCode: 7 };\n}\n",
      "src/substrate/adapters/terminal-input.ts": textFiles.read(terminal),
      "working/.keep": "",
    });
    const cwd = join(project.root, "working");
    const input = "native input\nsecond line\n";
    const result = processes.run(processes.node(), ["--experimental-strip-types", "--no-warnings", join(project.root, "scripts/driver.mjs"), "alpha", "β"], cwd, input);
    expect(result.status, result.stdout + result.stderr).toBe(7);
    expect(result.stderr).toBe("fixture warning\n");
    expect(result.stdout).toBe(JSON.stringify({ engineRoot: project.root, args: ["alpha", "β"], cwd, input }) + "\n");
  } finally {
    project.dispose();
  }
}, 120_000);

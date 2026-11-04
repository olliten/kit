import { join } from "node:path";
import { expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

test("a command's input is read whole from the real terminal input adapter", () => {
  const project = temporaryProjects.open("kit-native-stdin-");
  try {
    const terminal = new URL("../../src/substrate/adapters/terminal-input.ts", import.meta.url).href;
    project.write({
      "driver.mjs": `import { terminalInput } from ${JSON.stringify(terminal)};\nprocess.stdout.write(terminalInput.read() + '\\n');\n`,
    });
    const event = JSON.stringify({ tool_input: { file_path: "src/core/readings/total.ts" } });
    const result = processes.run(processes.node(), ["--experimental-strip-types", "--no-warnings", join(project.root, "driver.mjs")], project.root, event);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${event}\n`);
    expect(result.stderr).toBe("");
  } finally {
    project.dispose();
  }
});

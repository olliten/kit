import { join } from "node:path";
import { expect, test } from "vitest";
import { type FilesystemRead, filesystem } from "../../src/substrate/adapters/filesystem.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

test("a read that fails is a read too: it keeps its error code, so a file that appears later is a change", () => {
  const project = temporaryProjects.open("kit-failed-reads-");
  try {
    const trace: FilesystemRead[] = [];
    expect(() => filesystem.readText(join(project.root, "missing.ts"), trace)).toThrow();
    expect(() => filesystem.entries(join(project.root, "missing"), trace)).toThrow();
    expect(trace.map((read) => [read.operation, read.result])).toEqual([
      ["readText", { error: "ENOENT" }],
      ["entries", { error: "ENOENT" }],
    ]);
    project.write({ "missing.ts": "export {};\n" });
    const again = trace[0] === undefined ? undefined : filesystem.reread(trace[0]);
    expect(again?.result).not.toEqual({ error: "ENOENT" });
  } finally {
    project.dispose();
  }
});

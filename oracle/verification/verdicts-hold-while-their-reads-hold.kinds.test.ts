import { join } from "node:path";
import { expect, test } from "vitest";
import { filesystem } from "../../src/substrate/adapters/filesystem.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

test("a probe holds a path's current kind independently of content and detects file-directory transitions", () => {
  const project = temporaryProjects.open("kit-path-kinds-");
  const path = join(project.root, "subject");
  try {
    expect(filesystem.kind(path)).toBe("absent");
    project.write({ subject: "one" });
    expect(filesystem.kind(path)).toBe("file");
    project.write({ subject: "different contents" });
    expect(filesystem.kind(path)).toBe("file");
    project.remove("subject");
    project.directory("subject");
    expect(filesystem.kind(path)).toBe("directory");
    project.remove("subject");
    expect(filesystem.kind(path)).toBe("absent");
  } finally {
    project.dispose();
  }
});

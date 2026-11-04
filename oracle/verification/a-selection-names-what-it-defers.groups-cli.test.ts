import { join } from "node:path";
import { expect, test } from "vitest";
import { processes } from "../../src/substrate/adapters/processes.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";
import {
  DEFERRED_BROWSER as browser, DEFERRED_SELECTED as selected, deferredGroupFixture as files,
} from "../core/readings/deferred-group-fixture.js";

test("the real public launcher defers the browser group and its unchanged fresh full command still fails", () => {
  const project = temporaryProjects.open("kit-deferred-cli-");
  try {
    project.write(files());
    const command = join(import.meta.dirname, "../../scripts/kit-verify.mjs");
    const args = [command, "--root", project.root, "--config", join(project.root, "kit/config.md"), "--fresh"];
    const staging = processes.run(processes.node(), [...args, "--defer-group", "browser"], project.root);
    expect(staging.status).toBe(0);
    expect(staging.stdout).toContain("Kit verify null\nKit selection ");
    expect(JSON.parse(staging.stdout.split("Kit selection ")[1] ?? "null")).toMatchObject({
      selectionKind: "deferred-groups", deferredGroups: ["browser"], selected, deferred: [browser],
    });
    const full = processes.run(processes.node(), args, project.root);
    expect(full.status).toBe(1);
    expect(full.stdout).toContain(`failed test:${browser}`);
    expect(full.stdout).not.toContain("Kit selection ");
  } finally { project.dispose(); }
}, 120_000);

import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import { describeConsumer, pinnedKit, readCheck } from "../../core/readings/consumer-report.js";
import { normalizedPath } from "../../core/readings/kit-configuration.js";
import { processes } from "../adapters/processes.js";
import { textFiles } from "../adapters/text-files.js";

// Each app pins a Kit commit, so a change to Kit reaches an app only when the app moves its pin. This checks
// the apps against the Kit checked out here before that happens, so the findings a change brings become each
// app's list of work. A failing app does not fail the run: an app may go red and converge.
export async function runConsumers({ engineRoot, args: apps, cwd }: CommandRequest): Promise<CommandResponse> {
  let stdout = "";
  if (apps.length === 0) throw new Error("Name the app checkouts to check, such as ../tuck ../app.");
  const kit = processes.run("git", ["rev-parse", "HEAD"], engineRoot).stdout.trim();
  for (const given of apps) {
    const root = normalizedPath(given.startsWith("/") ? given : `${cwd}/${given}`);
    const run = processes.run(processes.node(), [
      `${engineRoot}/scripts/kit-check.mjs`,
      "--root",
      root,
      "--config",
      `${root}/kit/config.md`,
      "--baseline",
      `${root}/kit/debt/legacy.json`,
    ]);
    const read = readCheck(run.stdout, run.stderr);
    if (run.status !== 0 && read.failures.length === 0)
      throw new Error(`The Kit could not check ${given}:\n${run.stderr}`);
    const lock = `${root}/package-lock.json`;
    stdout +=
      describeConsumer({
        app: root.split("/").at(-1) ?? root,
        pinned: pinnedKit(textFiles.exists(lock) ? textFiles.read(lock) : null),
        kit,
        exitCode: run.status,
        ...read,
      }) + "\n";
  }
  return { stdout, stderr: "", exitCode: 0 };
}

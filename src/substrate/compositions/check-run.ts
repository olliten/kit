import { gate } from "../../core/compositions/gate.js";
import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import { kitCheckPaths } from "../../core/readings/check-paths.js";
import { ratchetFindings, startupCheckRoots, tightenedBaseline } from "../../core/readings/ratchet.js";
import { sameSnapshot } from "../../core/readings/snapshot-comparison.js";
import { compilerWorkspace } from "../adapters/compiler.js";
import { filesystem } from "../adapters/filesystem.js";
import { textFiles } from "../adapters/text-files.js";
import { cachedKitCheck } from "./cached-check.js";
import { readConfig } from "./read-config.js";
import { readSnapshot } from "./read-snapshot.js";

// `kit check`: read the governed root, run every rule, and fail on what the baseline doesn't hold. `--tighten`
// shrinks the baseline to what is left, `--report` prints the findings, and `--fresh-compare` proves the
// cache changed nothing.
export async function runCheck({ engineRoot, args, cwd }: CommandRequest): Promise<CommandResponse> {
  let stdout = "";
  let stderr = "";
  const { root, configPath, baselinePath } = kitCheckPaths(args, engineRoot, cwd);
  const loaded = readConfig(configPath);
  if ("failure" in loaded) return loaded.failure;
  const { config } = loaded;
  const check = (snapshot: Parameters<typeof gate>[0]) => gate(snapshot, config);
  const checked = await cachedKitCheck(root, config, readSnapshot, check, {
    filesystem,
    compiler: compilerWorkspace,
  });
  if (args.includes("--fresh-compare")) {
    const fresh = readSnapshot(root, config);
    if (!sameSnapshot(fresh, checked.snapshot) || JSON.stringify(check(fresh)) !== JSON.stringify(checked.result)) {
      return { stdout, stderr: "Kit cache diverged: a fresh extraction differs from the cached one.\n", exitCode: 2 };
    }
    stdout += "Kit fresh-compare: the cached snapshot equals a fresh extraction.\n";
  }
  const { findings, placedPaths, imports, requiredLimits } = checked.result;
  if (args.includes("--report"))
    return { stdout: stdout + JSON.stringify({ findings, receipt: checked.receipt }, null, 2) + "\n", stderr, exitCode: 0 };
  const baseline: unknown = JSON.parse(textFiles.read(baselinePath));
  if (typeof baseline !== "object" || baseline === null) throw new Error("A baseline is a record of debt keys.");
  const recorded = Object.fromEntries(Object.entries(baseline));
  const ratcheted = ratchetFindings(findings, recorded, placedPaths, imports, startupCheckRoots(config));
  const failures = [...new Map([...ratcheted, ...requiredLimits].map((item) => [item.debtKey, item])).values()];
  if (args.includes("--tighten")) {
    const tightened = JSON.stringify(tightenedBaseline(recorded, findings), null, 2) + "\n";
    if (tightened !== JSON.stringify(recorded, null, 2) + "\n") textFiles.write(baselinePath, tightened);
  }
  const counts: Record<string, number> = {};
  for (const item of findings) {
    const key = `${item.category}:${item.debtKey.split(":")[1]}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  stdout += "Kit check " + JSON.stringify({ ...(config.app === undefined ? {} : { app: config.app }), counts, receipt: checked.receipt }) + "\n";
  for (const item of findings.filter((item) => item.category === "checker-limit"))
    stdout += "Kit limit " + item.debtKey + ": " + item.limit + "\n";
  for (const item of failures) stderr += item.debtKey + ": " + item.fix + "\n";
  return { stdout, stderr, exitCode: failures.length > 0 ? 1 : 0 };
}

import { gate } from "../../core/compositions/gate.js";
import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import { baselineFiles, mergedBaseline } from "../../core/readings/baseline-files.js";
import { kitCheckPaths } from "../../core/readings/check-paths.js";
import { ratchetFindings, startupCheckRoots, tightenedBaseline } from "../../core/readings/ratchet.js";
import { evidenceStore } from "../adapters/evidence-store.js";
import { stopwatch } from "../adapters/stopwatch.js";
import { textFiles } from "../adapters/text-files.js";
import { toolchain } from "../adapters/toolchain.js";
import { readConfig } from "./read-config.js";
import { readStoredSnapshot } from "./read-snapshot.js";

// `kit check`: read the governed root, run every rule, and fail on what the baseline doesn't hold. Facts read
// before are reused while what they depend on is unchanged; `--fresh` reads everything again and stores nothing.
// `--tighten` shrinks the baseline to what is left, and `--report` prints the findings.
export async function runCheck({ engineRoot, args, cwd }: CommandRequest): Promise<CommandResponse> {
  let stdout = "";
  let stderr = "";
  const { root, configPath, baselinePath } = kitCheckPaths(args, engineRoot, cwd);
  const loaded = readConfig(configPath);
  if ("failure" in loaded) return loaded.failure;
  const { config } = loaded;
  const store = evidenceStore.directory(root);
  const started = stopwatch.now();
  const { snapshot, receipt: extraction } = readStoredSnapshot(
    root,
    config,
    args.includes("--fresh")
      ? undefined
      : {
          reuse: {
            read: (kind, key) => evidenceStore.read(store, kind, key),
            write: (kind, key, text) => evidenceStore.write(store, kind, key, text),
          },
          engine: toolchain.engine(engineRoot),
        },
  );
  if (!args.includes("--fresh")) evidenceStore.prune(store);
  const read = stopwatch.now();
  const result = gate(snapshot, config);
  const receipt = { ...extraction, seconds: (read - started) / 1000, checkSeconds: (stopwatch.now() - read) / 1000 };
  const checked = { result, receipt };
  const { findings, placedPaths, imports, requiredLimits } = checked.result;
  if (args.includes("--report"))
    return { stdout: stdout + JSON.stringify({ findings, receipt: checked.receipt }, null, 2) + "\n", stderr, exitCode: 0 };
  // A baseline is one file of debt keys, or a directory of one such file per finding path.
  const single = baselinePath.endsWith(".json");
  const kept = single
    ? [{ path: baselinePath, text: textFiles.read(baselinePath) }]
    : textFiles.exists(baselinePath)
      ? textFiles
          .entries(baselinePath)
          .filter((entry) => entry.file && entry.name.endsWith(".json"))
          .map((entry) => ({ path: `${baselinePath}/${entry.name}`, text: textFiles.read(`${baselinePath}/${entry.name}`) }))
      : [];
  const recorded = mergedBaseline(kept);
  const ratcheted = ratchetFindings(findings, recorded, placedPaths, imports, startupCheckRoots(config));
  const failures = [...new Map([...ratcheted, ...requiredLimits].map((item) => [item.debtKey, item])).values()];
  if (args.includes("--tighten")) {
    const tightened = tightenedBaseline(recorded, findings);
    if (single) {
      const text = JSON.stringify(tightened, null, 2) + "\n";
      if (text !== JSON.stringify(recorded, null, 2) + "\n") textFiles.write(baselinePath, text);
    } else {
      // Only the files whose keys changed are rewritten, and a file left with no keys is removed.
      const files = baselineFiles(baselinePath, tightened);
      for (const { path } of kept) if (!files.has(path)) textFiles.remove(path);
      for (const [path, text] of files) if (kept.find((file) => file.path === path)?.text !== text) textFiles.write(path, text);
    }
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

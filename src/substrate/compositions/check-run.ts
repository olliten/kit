import { gate } from "../../core/compositions/gate.js";
import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import { baselineFiles, mergedBaseline } from "../../core/readings/baseline-files.js";
import { kitCheckPaths } from "../../core/readings/check-paths.js";
import { paidDebt, reasonOf } from "../../core/readings/paid-debt.js";
import { ratchetFindings, startupCheckRoots, tightenedBaseline } from "../../core/readings/ratchet.js";
import { engagedRules } from "../../core/readings/rule-switch.js";
import { capabilityModules, testGroups } from "../../core/readings/test-groups.js";
import { holding, keptRuns, verdictKind, verdictOf } from "../../core/readings/verdict-reuse.js";
import { testLine } from "../../core/readings/verification-configuration.js";
import { evidenceStore } from "../adapters/evidence-store.js";
import { stopwatch } from "../adapters/stopwatch.js";
import { textFiles } from "../adapters/text-files.js";
import { toolchain } from "../adapters/toolchain.js";
import { heldStates } from "./held-state.js";
import { readConfig } from "./read-config.js";
import { readStoredSnapshot } from "./read-snapshot.js";

// `kit check`: read the governed root, run every rule, and fail on what the baseline doesn't hold. Facts read
// before are reused while what they depend on is unchanged; `--fresh` reads everything again and stores nothing.
// What each test ran comes from the passes `kit verify` kept, while each still holds.
// A baseline entry whose debt is paid fails until `--tighten` shrinks the baseline to what is left. `--report`
// prints the findings and the paid entries, each with the reason its entry carries. A pending finding is one
// stdout line with its declared reason, and never fails.
export async function runCheck({ engineRoot, args, cwd }: CommandRequest): Promise<CommandResponse> {
  let stdout = "";
  let stderr = "";
  const { root, configPath, baselinePath } = kitCheckPaths(args, engineRoot, cwd);
  const loaded = readConfig(configPath, root);
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
          reuse: evidenceStore.at(store),
          engine: toolchain.engine(engineRoot),
        },
  );
  if (!args.includes("--fresh")) evidenceStore.prune(store);
  // Only a test command that writes coverage keeps what tests ran; unless every group's does, the rules that read
  // it don't apply. Each test's pass is the one kept under the command of the group `kit verify` chose for it.
  const groups = config.verify?.tests ?? [];
  const records = groups.length > 0 && groups.every((group) => group.command.includes("{dir}"));
  const runtime = toolchain.runtime(root);
  const kit = toolchain.kit(engineRoot, root);
  const states = new Map<string, string>();
  const held = heldStates(root, kit);
  const tests = records ? snapshot.files.filter((file) => file.type === "test" && file.path.startsWith(`${config.oracleRoot}/`)).map((file) => file.path) : [];
  const chosen = testGroups(tests, groups, groups.some((group) => group.reaching !== undefined || group.capabilities !== undefined) ? snapshot.imports : [], capabilityModules(config));
  const passes = new Map(
    records
      ? tests
          .map((test) => {
            const group = chosen.get(test);
            const command = group === undefined ? undefined : groups[group]?.command;
            const verdicts =
              command === undefined
                ? []
                : evidenceStore.entries(store, verdictKind(`test:${test}`, testLine(command, test), runtime)).flatMap((text) => verdictOf(text) ?? []);
            for (const verdict of verdicts)
              for (const path of Object.keys(verdict.states))
                if (!states.has(path)) states.set(path, held.state(path));
            return [test, holding(verdicts, states)] as const;
          })
      : [],
  );
  const { runs, waiting } = records ? keptRuns(passes) : { runs: null, waiting: [] };
  // While the rules that read what tests ran wait, they read nothing, so the debt they recorded is left alone.
  const resting = waiting.length > 0 ? engagedRules(config).map((rule) => `R4:${rule}:`) : [];
  const read = stopwatch.now();
  const result = gate(runs === null ? snapshot : { ...snapshot, runs }, config);
  const receipt = { ...extraction, seconds: (read - started) / 1000, checkSeconds: (stopwatch.now() - read) / 1000 };
  const checked = { result, receipt };
  const { findings, placedPaths, imports, requiredLimits } = checked.result;
  // A baseline is one file of debt keys, or a directory of one such file per finding path. The report reads it
  // only for the reasons its entries carry, so a report needs none.
  const single = baselinePath.endsWith(".json");
  const report = args.includes("--report");
  const kept = single
    ? report && !textFiles.exists(baselinePath)
      ? []
      : [{ path: baselinePath, text: textFiles.read(baselinePath) }]
    : textFiles.exists(baselinePath)
      ? textFiles
          .entries(baselinePath)
          .filter((entry) => entry.file && entry.name.endsWith(".json"))
          .map((entry) => ({ path: `${baselinePath}/${entry.name}`, text: textFiles.read(`${baselinePath}/${entry.name}`) }))
      : [];
  const recorded = mergedBaseline(kept);
  if (report) {
    const reasoned = findings.map((item) => {
      const reason = reasonOf(recorded, item.debtKey);
      return reason === undefined ? item : { ...item, reason };
    });
    const stale = paidDebt(recorded, findings, resting);
    return { stdout: stdout + JSON.stringify({ findings: reasoned, stale, receipt: checked.receipt }, null, 2) + "\n", stderr, exitCode: 0 };
  }
  const ratcheted = ratchetFindings(findings, recorded, placedPaths, imports, startupCheckRoots(config));
  const failures = [...new Map([...ratcheted, ...requiredLimits].map((item) => [item.debtKey, item])).values()];
  const tightened = tightenedBaseline(recorded, findings, resting);
  if (args.includes("--tighten")) {
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
  // Paid debt is judged on the baseline as this run leaves it, so tightening clears it. A key that already
  // fails for another reason shows that failure's fix alone.
  const failing = new Set(failures.map((item) => item.debtKey));
  const paid = paidDebt(args.includes("--tighten") ? tightened : recorded, findings, resting).filter((item) => !failing.has(item.debtKey));
  const counts: Record<string, number> = {};
  for (const item of findings) {
    const key = `${item.category}:${item.debtKey.split(":")[1]}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  stdout += "Kit check " + JSON.stringify({ ...(config.app === undefined ? {} : { app: config.app }), counts, receipt: checked.receipt }) + "\n";
  if (waiting.length > 0)
    stdout += `Kit runs: the rules that read what tests ran wait for ${waiting.length} tests with no kept pass; run \`kit verify\`.\n`;
  for (const item of findings.filter((item) => item.category === "pending"))
    stdout += "Kit pending " + item.debtKey + ": " + (item.reason ?? "") + "\n";
  for (const item of findings.filter((item) => item.category === "checker-limit"))
    stdout += "Kit limit " + item.debtKey + ": " + item.limit + "\n";
  for (const item of [...failures, ...paid]) stderr += item.debtKey + ": " + item.fix + "\n";
  return { stdout, stderr, exitCode: failures.length + paid.length > 0 ? 1 : 0 };
}

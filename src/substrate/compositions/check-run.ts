import { gate } from "../../core/compositions/gate.js";
import type { CommandRequest, CommandResponse } from "../../core/primitives/command.js";
import type { DebtPolicy } from "../../core/primitives/debt-policy.js";
import type { Verdict } from "../../core/primitives/verdict.js";
import { baselineFiles, mergedBaseline } from "../../core/readings/baseline-files.js";
import { kitCheckPaths } from "../../core/readings/check-paths.js";
import { debtPolicyFindings, debtPolicyOf } from "../../core/readings/debt-comparison.js";
import { invocationPasses } from "../../core/readings/invocation-passes.js";
import { independentRuns } from "../../core/readings/independent-runs.js";
import { claimRuns } from "../../core/readings/claim-runs.js";
import { claimReach } from "../../core/readings/proof-reach.js";
import { proofOf } from "../../core/readings/placement-of.js";
import { paidDebt, ratchetFindings, reasonOf, startupCheckRoots, tightenedBaseline } from "../../core/readings/ratchet.js";
import { engagedRules } from "../../core/readings/rule-switch.js";
import { capabilityModules, testGroups } from "../../core/readings/test-groups.js";
import { holding, keptRuns, runtimeOf, verdictKind, verdictOf } from "../../core/readings/verdict-reuse.js";
import { testLine } from "../../core/readings/verification-configuration.js";
import { evidenceStore } from "../adapters/evidence-store.js";
import { stopwatch } from "../adapters/stopwatch.js";
import { textFiles } from "../adapters/text-files.js";
import { toolchain } from "../adapters/toolchain.js";
import { heldStates } from "./held-state.js";
import { readConfig } from "./read-config.js";
import { readStoredSnapshot } from "./read-snapshot.js";

function baselineTexts(path: string, optional: boolean): { path: string; text: string }[] {
  if (!textFiles.exists(path)) {
    if (optional) return [];
    throw new Error(`The baseline ${path} does not exist.`);
  }
  return path.endsWith(".json") ? [{ path, text: textFiles.read(path) }] : textFiles.entries(path)
    .filter((entry) => entry.file && entry.name.endsWith(".json"))
    .map((entry) => ({ path: `${path}/${entry.name}`, text: textFiles.read(`${path}/${entry.name}`) }));
}

// `kit check`: read the governed root, run every rule, and fail on what the baseline doesn't hold. Facts read
// before are reused while what they depend on is unchanged; `--fresh` reads everything again and stores nothing.
// What each test ran comes from the passes `kit verify` kept, while each still holds.
// A baseline entry whose debt is paid fails until `--tighten` shrinks the baseline to what is left. `--report`
// prints the findings and the paid entries, each with the reason its entry carries. A pending finding is one
// stdout line with its declared reason, and never fails.
export async function runCheck({ engineRoot, args, cwd }: CommandRequest): Promise<CommandResponse> {
  let stdout = "";
  let stderr = "";
  const { root, configPath, baselinePath, evidencePath, referencePath, footprintPath } = kitCheckPaths(args, engineRoot, cwd);
  let policy: DebtPolicy;
  try {
    policy = debtPolicyOf(args, footprintPath === undefined ? [] : JSON.parse(textFiles.read(footprintPath)));
    if (policy.mode === "paydown" && referencePath === undefined)
      throw new Error("Paydown requires --baseline-reference with the approved baseline.");
  } catch (error) {
    return { stdout, stderr: `Kit debt: ${error instanceof Error ? error.message : String(error)}\n`, exitCode: 2 };
  }
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
          reuse: evidenceStore.at(store),
          engine: toolchain.extraction(engineRoot),
        },
  );
  if (!args.includes("--fresh")) evidenceStore.prune(store);
  // Missing recording is missing proof, never permission to suspend an enabled execution rule. Each test's pass
  // belongs to the command of the group `kit verify` chose for it.
  const groups = config.verify?.tests ?? [];
  const records = groups.length > 0 && groups.every((group) => group.command.includes("{dir}"));
  const runtime = toolchain.runtime(root);
  const scripts = toolchain.scripts(root);
  const kit = toolchain.kit(engineRoot, root);
  const states = new Map<string, string>();
  const held = heldStates(root, kit);
  const tests = snapshot.files.filter((file) => file.type === "test").map((file) => file.path);
  const chosen = testGroups(tests, groups, groups.some((group) => group.reaching !== undefined || group.capabilities !== undefined) ? snapshot.imports : [], capabilityModules(config));
  const commands = new Map(tests.flatMap((test): [string, string][] => {
    const group = chosen.get(test);
    const command = group === undefined ? undefined : groups[group]?.command;
    return command === undefined ? [] : [[test, testLine(command, test, group === undefined ? [] : groups[group]?.contexts)]];
  }));
  let invocation: ReadonlyMap<string, Verdict> | undefined;
  try {
    invocation = evidencePath === undefined ? undefined : invocationPasses(textFiles.read(evidencePath), root, runtime, scripts, commands);
  } catch (error) {
    return { stdout, stderr: `Kit evidence: ${error instanceof Error ? error.message : String(error)}\n`, exitCode: 2 };
  }
  const passes = new Map(tests.map((test) => {
    const command = commands.get(test);
    const supplied = invocation?.get(test);
    const verdicts = invocation !== undefined ? supplied === undefined ? [] : [supplied] : command === undefined ? [] :
      evidenceStore.entries(store, verdictKind(`test:${test}`, command, runtimeOf(command, runtime, scripts)))
        .flatMap((text) => verdictOf(text) ?? [])
        .filter((verdict) => verdict.execution === undefined || verdict.execution.runtime === runtimeOf(command, runtime, scripts));
    for (const verdict of verdicts)
      for (const path of Object.keys(verdict.states))
        if (!states.has(path)) states.set(path, held.state(path));
    return [test, holding(verdicts, states)] as const;
  }));
  if (invocation !== undefined)
    for (const test of invocation.keys())
      if (passes.get(test) === undefined)
        return { stdout, stderr: `Kit evidence: ${test}'s inputs changed since this invocation ran.\n`, exitCode: 2 };
  const { runs, waiting } = keptRuns(passes);
  // Missing attribution must not look like a paid cohesion obligation. Preserve only the affected modules'
  // existing cohesion entries; ungoverned functions still produce findings from the sparse evidence.
  const independent = independentRuns(snapshot, runs);
  const uncaptured = tests.filter((test) => !Object.hasOwn(independent.tests, test));
  const uncertain = new Set(uncaptured.flatMap((test) => {
    const proof = proofOf(test, config.oracleRoot);
    return proof === null ? [] : [`${config.specRoot}/${proof.topic}.md:${proof.anchor}`];
  }));
  const reached = claimReach(snapshot);
  const resting = [
    ...claimRuns(snapshot, runs).filter(({ module, naming }) =>
      [...uncertain].some((claim) => naming.has(claim) || reached.get(claim)?.files.has(module)),
    ).map(({ module }) => `R4:excerpt-cohesion:${module}:`),
    ...(["ungoverned-function", "excerpt-cohesion"] as const)
      .filter((rule) => config.rules?.[rule] !== undefined).map((rule) => `R4:${rule}:`),
  ];
  const read = stopwatch.now();
  const result = gate({ ...snapshot, runs }, config);
  const receipt = { ...extraction, seconds: (read - started) / 1000, checkSeconds: (stopwatch.now() - read) / 1000 };
  const checked = { result, receipt };
  const { findings, placedPaths, imports, requiredLimits } = checked.result;
  // A baseline is one file of debt keys, or a directory of one such file per finding path. The report reads it
  // only for the reasons its entries carry, so a report needs none.
  const single = baselinePath.endsWith(".json");
  const report = args.includes("--report");
  const kept = baselineTexts(baselinePath, report || !single);
  const recorded = mergedBaseline(kept);
  const tightened = tightenedBaseline(recorded, findings, resting);
  const left = !report && args.includes("--tighten") ? tightened : recorded;
  let compared: ReturnType<typeof debtPolicyFindings> = [];
  try {
    if (referencePath !== undefined)
      compared = debtPolicyFindings(findings, left, mergedBaseline(baselineTexts(referencePath, false)), policy, resting);
  } catch (error) {
    return { stdout, stderr: `Kit debt: ${error instanceof Error ? error.message : String(error)}\n`, exitCode: 2 };
  }
  if (report) {
    const reasoned = findings.map((item) => {
      const reason = reasonOf(recorded, item.debtKey);
      return reason === undefined ? item : { ...item, reason };
    });
    const stale = paidDebt(recorded, findings, resting);
    return { stdout: stdout + JSON.stringify({ findings: reasoned, stale, ...(referencePath === undefined ? {} : { policyFailures: compared }), receipt: checked.receipt }, null, 2) + "\n", stderr, exitCode: 0 };
  }
  const ratcheted = ratchetFindings(findings, recorded, placedPaths, imports, startupCheckRoots(config));
  const failures = [...new Map([...ratcheted, ...requiredLimits, ...compared].map((item) => [item.debtKey, item])).values()];
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
  const paid = paidDebt(left, findings, resting).filter((item) => !failing.has(item.debtKey));
  const counts: Record<string, number> = {};
  for (const item of findings) {
    const key = `${item.category}:${item.debtKey.split(":")[1]}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  stdout += "Kit check " + JSON.stringify({ ...(config.app === undefined ? {} : { app: config.app }), debtMode: policy.mode, counts, receipt: checked.receipt }) + "\n";
  for (const rule of ["ungoverned-function", "excerpt-cohesion"] as const) {
    const disabled = config.rules?.[rule];
    if (disabled !== undefined) stdout += `Kit runs: ${rule} is switched off: ${disabled.off}\n`;
  }
  if (!records && engagedRules(config).length > 0)
    stdout += "Kit runs: execution obligations are not established; configure a recording test command with {dir} and run `kit verify`.\n";
  if (waiting.length > 0)
    stdout += `Kit runs: ${waiting.length} tests have no current execution evidence; unproved functions remain obligations. Run \`kit verify\`.\n`;
  for (const item of findings.filter((item) => item.category === "pending"))
    stdout += "Kit pending " + item.debtKey + ": " + (item.reason ?? "") + "\n";
  for (const item of findings.filter((item) => item.category === "checker-limit"))
    stdout += "Kit limit " + item.debtKey + ": " + item.limit + "\n";
  for (const item of [...failures, ...paid]) stderr += item.debtKey + ": " + item.fix + "\n";
  return { stdout, stderr, exitCode: failures.length + paid.length > 0 ? 1 : 0 };
}

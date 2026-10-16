import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configuredKit, kitCheckPaths, kitConfig } from "./kit-config.mjs";
import { isKitMain, withKit } from "./kit-load.mjs";
import { cachedKitCheck } from "./kit-snapshot-cache.mjs";

export function startupCheckRoots(config) {
  return (config.exceptions ?? []).filter((path) => path.startsWith(`${config.srcRoot}/`));
}

export function ratchetFindings(findings, baselineKeys, placedPaths, imports, requiredRoots = []) {
  const baseline = new Set(baselineKeys);
  const reachable = new Set([...placedPaths, ...requiredRoots]);
  const pending = [...reachable];
  const edges = new Map();
  for (const { from, to } of imports) {
    const targets = edges.get(from) ?? [];
    targets.push(to);
    edges.set(from, targets);
  }
  while (pending.length > 0)
    for (const target of edges.get(pending.pop()) ?? [])
      if (!reachable.has(target)) {
        reachable.add(target);
        pending.push(target);
      }
  return findings.filter((item) =>
    item.category === "checker-limit"
      ? reachable.has(item.path)
      : item.category === "placed-violation" || !baseline.has(item.debtKey),
  );
}

async function main() {
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { root, configPath, baselinePath } = kitCheckPaths(process.argv.slice(2), engineRoot);
  const declared = kitConfig(readFileSync(configPath, "utf8"));
  await withKit(engineRoot, async (load) => {
    const { DEFAULT_CONFIG } = await load("src/core/primitives/default-config.ts");
    const { readSnapshot } = await load("src/substrate/compositions/read-snapshot.ts");
    const { capabilityCheck } = await load("src/core/readings/capability-check.ts");
    const { moduleReferences } = await load("src/core/readings/module-references.ts");
    const { claimProofBinder } = await load("src/core/readings/claim-proof-binder.ts");
    const { proofReach } = await load("src/core/readings/proof-reach.ts");
    const { byDebtKey } = await load("src/core/readings/finding.ts");
    const { nameCheck } = await load("src/core/readings/name-check.ts");
    const { commentCheck } = await load("src/core/readings/comment-check.ts");
    const { referenceCheck } = await load("src/core/readings/semantic-references.ts");
    const { termModel, termOrder } = await load("src/core/readings/term-model.ts");
    const { placementOf } = await load("src/core/readings/placement-of.ts");
    const { topicShape } = await load("src/core/readings/topic-shape.ts");
    const config = configuredKit(DEFAULT_CONFIG, declared);
    const checked = await cachedKitCheck(
      root,
      config,
      readSnapshot,
      (snapshot) => {
        const capability = capabilityCheck(snapshot);
        const concepts = termModel(snapshot);
        const topicSnapshot = {
          ...snapshot,
          claims: snapshot.claims.filter((claim) => !config.legacyAreas.includes(claim.file)),
        };
        const structural = [
          ...[
            ...moduleReferences(topicSnapshot),
            ...claimProofBinder(topicSnapshot),
            ...proofReach(topicSnapshot),
          ].sort(byDebtKey),
          ...nameCheck(snapshot),
          ...commentCheck(snapshot),
          ...referenceCheck(snapshot),
          ...topicShape(snapshot),
          ...termOrder(snapshot),
          ...concepts.findings,
        ].map((item) => ({
          ...item,
          category: "placed-violation",
          status: "violation",
          blocking: true,
          limit: "",
        }));
        const conceptLimits = concepts.limits.map((item) => ({
          ...item,
          category: "checker-limit",
          status: "unresolved",
          blocking: true,
          limit: item.fix,
        }));
        const findings = [...capability.findings, ...structural, ...conceptLimits];
        const placedPaths = snapshot.files
          .filter((file) => file.type === "source" && placementOf(file.path, config.srcRoot).placed)
          .map((file) => file.path);
        const imports = snapshot.compiler.projects.flatMap((project) =>
          project.imports
            .filter((edge) => !edge.typeOnly && edge.target !== null)
            .map((edge) => ({ from: edge.file, to: edge.target })),
        );
        return { findings, placedPaths, imports };
      },
      root === engineRoot ? [] : [engineRoot],
    );
    const { findings, placedPaths, imports } = checked.result;
    if (process.argv.includes("--report")) {
      process.stdout.write(JSON.stringify({ findings, receipt: checked.receipt }, null, 2) + "\n");
      return;
    }
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const failures = ratchetFindings(
      findings,
      Object.keys(baseline),
      placedPaths,
      imports,
      startupCheckRoots(config),
    );
    const counts = {};
    for (const item of findings) {
      const key = item.category + ":" + item.debtKey.split(":")[1];
      counts[key] = (counts[key] ?? 0) + 1;
    }
    process.stdout.write(
      "Kit check " + JSON.stringify({ counts, receipt: checked.receipt }) + "\n",
    );
    for (const item of findings.filter((item) => item.category === "checker-limit"))
      process.stdout.write("Kit limit " + item.debtKey + ": " + item.limit + "\n");
    for (const item of failures) process.stderr.write(item.debtKey + ": " + item.fix + "\n");
    if (failures.length > 0) process.exitCode = 1;
  });
}

if (isKitMain(import.meta.url)) await main();

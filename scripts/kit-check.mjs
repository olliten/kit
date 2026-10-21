import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configuredKit, kitCheckPaths, kitConfig } from "./kit-config.mjs";
import { isKitMain, withKit } from "./kit-load.mjs";
import { cachedKitCheck } from "./kit-snapshot-cache.mjs";

export function startupCheckRoots(config) {
  const roots = typeof config.srcRoot === "string" ? [config.srcRoot] : config.srcRoot;
  return (config.exceptions ?? []).filter((path) => roots.some((root) => path.startsWith(`${root}/`)));
}

/** Compare shared snapshot graphs without expanding their references into JSON text. */
export function sameSnapshot(first, second) {
  const pairs = new WeakMap();
  const name = (value) => value.replace(/^__@([\w$]+)@\d+$/, "__@$1");
  const keys = (value) => Object.keys(value).filter((key) => value[key] !== undefined);
  const same = (a, b) => {
    if (Object.is(a, b)) return true;
    if (typeof a === "string" && typeof b === "string") return name(a) === name(b);
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && a.length !== b.length) return false;
    const known = pairs.get(a);
    if (known?.has(b)) return true;
    if (known) known.add(b);
    else pairs.set(a, new WeakSet([b]));
    const ak = keys(a);
    const bk = keys(b);
    return ak.length === bk.length && ak.every((key, i) =>
      name(key) === name(bk[i]) && same(a[key], b[bk[i]]),
    );
  };
  return same(first, second);
}

// A baseline names each debt key it holds; it is a record, or a plain list of keys in a test. A legacy module's
// size entry records its statements and how many of them only call into placed code.
function recorded(baseline) {
  return Array.isArray(baseline) ? Object.fromEntries(baseline.map((key) => [key, null])) : baseline;
}

function recordedSize(entry) {
  const statements = entry?.statements;
  const calls = entry?.calls;
  return Number.isInteger(statements) && Number.isInteger(calls) && calls >= 0 && calls <= statements
    ? { statements, calls }
    : undefined;
}

// A legacy module may grow by at most `growth` statements, and only by calls into placed code: its other
// statements may not grow at all. A module the baseline holds no size for is new debt.
function sizeFailure(item, baseline, growth) {
  const base = Object.hasOwn(baseline, item.debtKey) ? recordedSize(baseline[item.debtKey]) : undefined;
  if (base === undefined)
    return {
      ...item,
      fix: `This legacy module has no recorded size, so its ${item.statements} statements are new debt: place it.`,
    };
  const grown = item.statements - base.statements;
  const unplaced = item.statements - item.calls - (base.statements - base.calls);
  if (grown <= growth && unplaced <= 0) return undefined;
  return {
    ...item,
    fix:
      `This legacy module has ${item.statements} statements, ${item.calls} of them calls into placed modules; ` +
      `its baseline records ${base.statements} and ${base.calls}. A change may add at most ${growth}, each only ` +
      "a call into a placed module: move the new code into a placed module and call it from here.",
  };
}

export function ratchetFindings(findings, baseline, placedPaths, imports, requiredRoots = [], growth = 0) {
  const entries = recorded(baseline);
  const keys = new Set(Object.keys(entries));
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
  return findings.flatMap((item) => {
    if (item.category === "checker-limit") return reachable.has(item.path) ? [item] : [];
    if (item.category === "placed-violation") return [item];
    if (typeof item.statements === "number") return sizeFailure(item, entries, growth) ?? [];
    return keys.has(item.debtKey) ? [] : [item];
  });
}

// The baseline only shrinks: a key whose debt is paid leaves it, and a legacy module's size entry takes the
// smaller of what it records and what the module holds now, for its statements and for those that are not
// calls into placed code. Nothing is added, so growth a change was allowed is never recorded.
export function tightenedBaseline(baseline, findings) {
  const current = new Map(
    findings.filter((item) => item.category === "legacy-debt").map((item) => [item.debtKey, item]),
  );
  return Object.fromEntries(
    Object.entries(recorded(baseline)).flatMap(([key, entry]) => {
      const now = current.get(key);
      if (now === undefined) return [];
      const base = typeof now.statements === "number" ? recordedSize(entry) : undefined;
      if (base === undefined) return [[key, entry]];
      const statements = Math.min(base.statements, now.statements);
      const unplaced = Math.min(base.statements - base.calls, now.statements - now.calls);
      return [[key, { ...entry, statements, calls: statements - unplaced }]];
    }),
  );
}

async function main() {
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { root, configPath, baselinePath } = kitCheckPaths(process.argv.slice(2), engineRoot);
  const declared = kitConfig(readFileSync(configPath, "utf8"));
  await withKit(engineRoot, async (load) => {
    const { DEFAULT_CONFIG } = await load("src/core/primitives/default-config.ts");
    const { readSnapshot, readSnapshotMetadata } = await load("src/substrate/compositions/read-snapshot.ts");
    const { filesystem } = await load("src/substrate/adapters/filesystem.ts");
    const { compilerWorkspace } = await load("src/substrate/adapters/compiler.ts");
    const { capabilityCheck } = await load("src/core/readings/capability-check.ts");
    const { dependencyExclusions } = await load("src/core/readings/dependency-check.ts");
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
    const { legacySize } = await load("src/core/readings/legacy-size.ts");
    const config = configuredKit(DEFAULT_CONFIG, declared);
    const topicSnapshotOf = (snapshot) => ({
      ...snapshot,
      claims: snapshot.claims.filter((claim) =>
        !config.legacyAreas.includes(claim.file) || claim.implementation || claim.proof,
      ),
    });
    if (!["--report", "--tighten", "--fresh-compare"].some((flag) => process.argv.includes(flag))) {
      const metadata = readSnapshotMetadata(root, config);
      const failures = [
        ...claimProofBinder(topicSnapshotOf(metadata)),
        ...topicShape(metadata),
        ...commentCheck(metadata),
      ].sort(byDebtKey);
      if (failures.length > 0) {
        for (const item of failures) process.stderr.write(item.debtKey + ": " + item.fix + "\n");
        process.exitCode = 1;
        return;
      }
    }
    const checkSnapshot = (snapshot) => {
      const capability = capabilityCheck(snapshot);
      const exclusions = dependencyExclusions(snapshot);
      const concepts = termModel(snapshot);
      const topicSnapshot = topicSnapshotOf(snapshot);
      const structural = [
        ...exclusions.findings,
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
      const limitOf = (item) => ({
        ...item,
        category: "checker-limit",
        status: "unresolved",
        blocking: true,
        limit: item.fix,
      });
      const conceptLimits = concepts.limits.map(limitOf);
      const requiredLimits = exclusions.limits.map(limitOf);
      const findings = [
        ...capability.findings,
        ...legacySize(snapshot),
        ...structural,
        ...conceptLimits,
        ...requiredLimits,
      ];
      const placedPaths = snapshot.files
        .filter((file) => file.type === "source" && placementOf(file.path, config.srcRoot).placed)
        .map((file) => file.path);
      const imports = snapshot.compiler.projects.flatMap((project) =>
        project.imports
          .filter((edge) => !edge.typeOnly && edge.target !== null)
          .map((edge) => ({ from: edge.file, to: edge.target })),
      );
      return { findings, placedPaths, imports, requiredLimits };
    };
    const checked = await cachedKitCheck(root, config, readSnapshot, checkSnapshot, {
      filesystem,
      compiler: compilerWorkspace,
    });
    // A gate that wants proof the cache changed nothing extracts again and compares. The compiler numbers
    // well-known symbols per process, so a second extraction in one process differs only in those numbers.
    if (process.argv.includes("--fresh-compare")) {
      const fresh = readSnapshot(root, config);
      const same =
        sameSnapshot(fresh, checked.snapshot) &&
        JSON.stringify(checkSnapshot(fresh)) === JSON.stringify(checked.result);
      if (!same) {
        process.stderr.write("Kit cache diverged: a fresh extraction differs from the cached one.\n");
        process.exitCode = 2;
        return;
      }
      process.stdout.write("Kit fresh-compare: the cached snapshot equals a fresh extraction.\n");
    }
    const { findings, placedPaths, imports, requiredLimits } = checked.result;
    if (process.argv.includes("--report")) {
      process.stdout.write(JSON.stringify({ findings, receipt: checked.receipt }, null, 2) + "\n");
      return;
    }
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ratcheted = ratchetFindings(
      findings,
      baseline,
      placedPaths,
      imports,
      startupCheckRoots(config),
      config.legacyGrowth,
    );
    const failures = [...new Map([...ratcheted, ...requiredLimits].map((item) => [item.debtKey, item])).values()];
    if (process.argv.includes("--tighten")) {
      const tightened = JSON.stringify(tightenedBaseline(baseline, findings), null, 2) + "\n";
      if (tightened !== JSON.stringify(baseline, null, 2) + "\n") writeFileSync(baselinePath, tightened);
    }
    const counts = {};
    for (const item of findings) {
      const key = item.category + ":" + item.debtKey.split(":")[1];
      counts[key] = (counts[key] ?? 0) + 1;
    }
    process.stdout.write("Kit check " + JSON.stringify({ counts, receipt: checked.receipt }) + "\n");
    for (const item of findings.filter((item) => item.category === "checker-limit"))
      process.stdout.write("Kit limit " + item.debtKey + ": " + item.limit + "\n");
    for (const item of failures) process.stderr.write(item.debtKey + ": " + item.fix + "\n");
    if (failures.length > 0) process.exitCode = 1;
  });
}

if (isKitMain(import.meta.url)) await main();

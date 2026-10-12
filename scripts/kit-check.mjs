import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cachedKitCheck } from "./kit-snapshot-cache.mjs";
import { kitConfig } from "./kit-config.mjs";

export function ratchetFindings(findings, baselineKeys, placedPaths, imports) {
  const baseline = new Set(baselineKeys);
  const reachable = new Set(placedPaths);
  const pending = [...placedPaths];
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
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const declared = kitConfig(readFileSync(join(root, "kit/config.md"), "utf8"));
  const { createServer } = await import("vite");
  const { ViteNodeServer } = await import("vite-node/server");
  const { ViteNodeRunner } = await import("vite-node/client");
  const server = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const loader = new ViteNodeServer(server, {
      deps: { external: ["typescript", "mdast-util-from-markdown"] },
    });
    const runner = new ViteNodeRunner({
      root,
      base: server.config.base,
      fetchModule: (id) => loader.fetchModule(id),
      resolveId: (id, importer) => loader.resolveId(id, importer),
    });
    const load = (name) => runner.executeFile(join(root, name));
    const { DEFAULT_CONFIG } = await load("kit/src/core/primitives/default-config.ts");
    const { readSnapshot } = await load("kit/src/substrate/primitives/read-snapshot.ts");
    const { capabilityCheck } = await load("kit/src/core/readings/capability-check.ts");
    const { binder } = await load("kit/src/core/readings/binder.ts");
    const { nameCheck } = await load("kit/src/core/readings/name-check.ts");
    const { commentCheck } = await load("kit/src/core/readings/comment-check.ts");
    const config = {
      ...DEFAULT_CONFIG,
      srcRoot: declared.roots.src.replace(/\/$/, ""),
      specRoot: declared.roots.spec.replace(/\/$/, ""),
      oracleRoot: declared.roots.oracle.replace(/\/$/, ""),
      termsFile: declared.terms,
      claimSeparator: declared["claim-separator"],
      legacyAreas: declared["legacy-areas"],
      adapters: declared.adapters ?? [],
      packages: declared.packages ?? [],
    };
    const checked = await cachedKitCheck(root, config, readSnapshot, (snapshot) => {
      const capability = capabilityCheck(snapshot);
      const topicSnapshot = {
        ...snapshot,
        claims: snapshot.claims.filter((claim) => !config.legacyAreas.includes(claim.file)),
      };
      const structural = [
        ...binder(topicSnapshot),
        ...nameCheck(snapshot),
        ...commentCheck(snapshot),
      ].map((item) => ({
        ...item,
        category: "placed-violation",
        status: "violation",
        blocking: true,
        limit: "",
      }));
      const findings = [...capability.findings, ...structural];
      const placedPaths = snapshot.files
        .filter(
          (file) =>
            file.type === "source" &&
            /^src\/(?:core|shell|substrate)\/(?:primitives|readings|compositions)\/[^/]+\.ts$/.test(
              file.path,
            ),
        )
        .map((file) => file.path);
      const imports = snapshot.compiler.projects.flatMap((project) =>
        project.imports
          .filter((edge) => !edge.typeOnly && edge.target !== null)
          .map((edge) => ({ from: edge.file, to: edge.target })),
      );
      return { findings, placedPaths, imports };
    });
    const { findings, placedPaths, imports } = checked.result;
    if (process.argv.includes("--report")) {
      process.stdout.write(JSON.stringify({ findings, receipt: checked.receipt }, null, 2) + "\n");
      return;
    }
    const baseline = JSON.parse(readFileSync(join(root, "kit/debt/legacy.json"), "utf8"));
    const failures = ratchetFindings(findings, Object.keys(baseline), placedPaths, imports);
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
  } finally {
    await server.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();

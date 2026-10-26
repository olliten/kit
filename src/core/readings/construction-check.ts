import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { legacyCodeOf, moduleFileOf, placementOf, rootOf } from "./placement-of.js";

export interface ConstructionFinding extends Finding {
  readonly category: "legacy-debt" | "placed-violation" | "checker-limit";
  readonly status: "violation" | "unresolved";
  readonly blocking: true;
  readonly limit: string;
}

// Who may build a value: an adapter its contract and ports, so a value of a contract carries what the
// adapter's file shows; a declared core producer its write descriptions, as data. A declared entrypoint, given
// as `startups`, may build test doubles of a contract.
export function constructionCheck(snapshot: Snapshot, startups: readonly string[]): ConstructionFinding[] {
  const { srcRoot, layerNames, layout } = snapshot.config;
  const adapters = snapshot.config.adapters ?? [];
  const projects = snapshot.compiler?.projects ?? [];
  const pathOf = (module: string): string => moduleFileOf(module, srcRoot, layerNames);
  const placed = (path: string): ReturnType<typeof placementOf> => placementOf(path, srcRoot, layerNames);
  const checked = (path: string): boolean =>
    startups.includes(path) || rootOf(path, srcRoot) !== undefined || legacyCodeOf(path, layout?.legacy);
  const findings: ConstructionFinding[] = [];
  const add = (rule: "R1" | "R2", check: string, path: string, fix: string, detail: string): void => {
    findings.push({
      ...finding(rule, check, path, fix, detail),
      category: placed(path).placed || startups.includes(path) ? "placed-violation" : "legacy-debt",
      status: "violation",
      blocking: true,
      limit: "",
    });
  };
  const contractHomes = new Map(
    adapters.flatMap((adapter) => {
      const file = pathOf(adapter.module);
      return adapter.kind !== "external" || adapter.contract === undefined
        ? []
        : projects
            .flatMap((project) => project.contracts)
            .filter((fact) => fact.file === file && fact.name === adapter.contract?.type)
            .flatMap((fact) => [...(fact.type === null ? [] : [fact.type]), ...(fact.ports ?? [])])
            .map((type) => [`${type.file}:${type.name}`, file] as const);
    }),
  );
  const descriptions = adapters
    .filter((adapter) => adapter.kind === "produce")
    .flatMap((adapter) => {
      const path = pathOf(adapter.module);
      const types = projects
        .flatMap((project) => project.exports)
        .filter((symbol) => symbol.file === path && symbol.name === adapter.export)
        .flatMap((symbol) => (symbol.resultType === null ? [] : [symbol.resultType]));
      if (types.length === 0)
        findings.push({
          ...finding(
            "R1",
            "producer-result",
            path,
            "Establish this boundary through a supported adapter or retain its explicit uncertainty.",
            adapter.export,
          ),
          category: "checker-limit",
          status: "unresolved",
          blocking: true,
          limit:
            "The declared producer result has no supported direct named data contract; unions and wrapped results are not guessed.",
        });
      return types.map((type) => ({ ...adapter, type }));
    });
  const coreProducer = (adapter: (typeof adapters)[number]): boolean => {
    const at = placed(pathOf(adapter.module));
    return (
      adapter.kind === "produce" &&
      at.placed &&
      at.zone === "core" &&
      at.layer === "compositions" &&
      adapter.zones.includes("core") &&
      (adapter.primitives?.length ?? 0) === 0 &&
      (adapter.globals?.length ?? 0) === 0
    );
  };
  for (const construction of projects.flatMap((project) => project.constructions)) {
    if (!checked(construction.file)) continue;
    const site = construction.site ?? String(construction.start);
    if (!startups.includes(construction.file))
      for (const type of construction.types) {
        const home = contractHomes.get(`${type.file}:${type.name}`);
        if (home !== undefined && home !== construction.file)
          add(
            "R1",
            "contract-construction",
            construction.file,
            "Let the adapter construct values of its contract, and hand those along instead.",
            type.name,
          );
      }
    const matching = descriptions.filter((adapter) =>
      construction.types.some((type) => type.file === adapter.type.file && type.name === adapter.type.name),
    );
    if (matching.length === 0) continue;
    if (!matching.some((adapter) => coreProducer(adapter) && construction.file === pathOf(adapter.module)))
      add(
        "R2",
        "write-construction",
        construction.file,
        "Construct this description only in its declared Core producer.",
        site,
      );
    if (construction.callable)
      add(
        "R1",
        "description-callable",
        construction.file,
        "Describe the operation and its arguments as data rather than a closure.",
        site,
      );
  }
  return [...new Map(findings.map((item) => [item.debtKey, item])).values()].sort(byDebtKey);
}

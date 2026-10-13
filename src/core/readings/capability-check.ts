import { cycles } from "./dependency-check.js";
import { type Finding, byDebtKey, finding } from "./finding.js";

export interface CapabilityFinding extends Finding {
  readonly status: "violation" | "unresolved" | "review-held";
  readonly blocking: boolean;
  readonly limit: string;
  readonly category: "legacy-debt" | "checker-limit" | "placed-violation";
}

export interface CapabilityResult {
  readonly requirements: readonly {
    readonly path: string;
    readonly direct: readonly string[];
    readonly inherited: readonly string[];
  }[];
  readonly findings: readonly CapabilityFinding[];
}

export function capabilityCheck(snapshot: Snapshot): CapabilityResult {
  const prefix = `${snapshot.config.srcRoot}/`;
  const layers: readonly string[] = LAYERS;
  const directory = (layer: string): string =>
    Object.entries(snapshot.config.layerNames ?? {}).find(([name]) => name === layer)?.[1] ?? layer;
  const directories = layers.map(directory);
  if (
    new Set(directories).size !== layers.length ||
    directories.some((name) => !/^[a-z][a-z0-9-]*$/.test(name))
  )
    return {
      requirements: [],
      findings: [
        {
          ...finding(
            "R1",
            "layer-config",
            snapshot.config.srcRoot,
            "Declare one distinct directory name for each of the four layers.",
          ),
          status: "unresolved",
          blocking: true,
          limit: "Ambiguous or non-directory names cannot establish module placement.",
          category: "checker-limit",
        },
      ],
    };
  const placement = (path: string): readonly string[] | null => {
    if (!path.startsWith(prefix)) return null;
    const [zone, physical, file, ...deeper] = path.slice(prefix.length).split("/");
    const layer = layers.find((name) => directory(name) === physical);
    if (
      zone === undefined ||
      !["core", "shell", "substrate"].includes(zone) ||
      layer === undefined ||
      file === undefined ||
      !/^[^/]+\.[^.]+$/.test(file) ||
      deeper.length > 0
    )
      return null;
    return [path.slice(prefix.length), zone, layer, file];
  };
  const files = snapshot.files
    .filter((file) => file.type === "source" && file.path.startsWith(prefix))
    .map((file) => file.path);
  const adapters = snapshot.config.adapters ?? [];
  const pathOf = (module: string): string => {
    const [zone, layer, name] = module.split("/");
    return `${prefix}${zone ?? ""}/${directory(layer ?? "")}/${name ?? ""}.ts`;
  };
  const projects = snapshot.compiler?.projects ?? [];
  const contracts = new Map(
    adapters.map((adapter) => {
      const contract = adapter.contract;
      if (contract === undefined) return [adapter, []];
      const file = pathOf(adapter.module);
      const facts = projects
        .flatMap((project) => project.contracts)
        .filter(
          (fact) =>
            fact.file === file &&
            ("type" in contract
              ? fact.parameter === null && fact.name === contract.type
              : fact.parameter === contract.parameter && fact.name === adapter.export),
        );
      return [adapter, facts];
    }),
  );
  const contractTypes = adapters.flatMap((adapter) =>
    (contracts.get(adapter) ?? []).flatMap((fact) =>
      fact.type === null ? [] : [{ capability: adapter.capability, type: fact.type }],
    ),
  );
  const direct = new Map(files.map((path) => [path, new Set<string>()]));
  const findings: CapabilityFinding[] = [];
  const rawFailures = new Set<string>();
  const add = (
    rule: "R1" | "R2",
    check: string,
    path: string,
    fix: string,
    detail?: string,
    status: CapabilityFinding["status"] = "violation",
    blocking = true,
    limit = "",
  ): void => {
    findings.push({
      ...finding(rule, check, path, fix, detail),
      status,
      blocking,
      limit,
      category:
        status !== "violation"
          ? "checker-limit"
          : placement(path) === null
            ? "legacy-debt"
            : "placed-violation",
    });
  };
  const unresolved = (check: string, path: string, limit: string, detail?: string): void =>
    add(
      "R1",
      check,
      path,
      "Establish this boundary through a supported adapter or retain its explicit uncertainty.",
      detail,
      "unresolved",
      true,
      limit,
    );
  if (projects.length === 0)
    for (const path of files)
      unresolved("compiler-boundary", path, "No compiler project covers the source.");
  else
    for (const path of files)
      if (!projects.some((project) => project.files.includes(path)))
        unresolved(
          "compiler-boundary",
          path,
          "The source is excluded from every compiler project.",
        );

  for (const adapter of adapters) {
    const path = pathOf(adapter.module);
    direct.get(path)?.add(adapter.capability);
    const exports = projects
      .flatMap((project) => project.exports)
      .filter((symbol) => symbol.file === path && symbol.name === adapter.export);
    if (exports.length === 0)
      unresolved(
        "adapter-boundary",
        path,
        "The declared adapter export is not resolved by the compiler.",
        adapter.export,
      );
    if (adapter.kind === "external" && placement(path)?.[2] !== "adapters")
      add(
        "R1",
        "adapter-layer",
        path,
        "Keep raw authority in a narrow capability adapter.",
        adapter.export,
      );
    const contract = adapter.contract;
    if (contract !== undefined) {
      const matches = contracts.get(adapter) ?? [];
      if (matches.length === 0)
        unresolved(
          "adapter-contract",
          path,
          "The declared operation type is not resolved.",
          adapter.export,
        );
      if (matches.some((fact) => fact.type === null))
        unresolved(
          "adapter-contract",
          path,
          "Anonymous or wrapped operation types have no supported canonical identity.",
          adapter.export,
        );
    }
  }
  const descriptions = adapters
    .filter((adapter) => adapter.kind === "produce")
    .flatMap((adapter) => {
      const path = pathOf(adapter.module);
      const results = projects
        .flatMap((project) => project.exports)
        .filter((symbol) => symbol.file === path && symbol.name === adapter.export);
      const types = results.flatMap((symbol) =>
        symbol.resultType === null ? [] : [symbol.resultType],
      );
      if (types.length === 0)
        unresolved(
          "producer-result",
          path,
          "The declared producer result has no supported direct named data contract; unions and wrapped results are not guessed.",
          adapter.export,
        );
      return types.map((type) => ({ ...adapter, type }));
    });
  for (const project of projects) {
    if (!project.settings.noImplicitAny || !project.settings.strictNullChecks)
      for (const path of project.files)
        if (direct.has(path))
          add(
            "R1",
            "compiler-settings",
            path,
            "Restore strict implicit-value and null checking for this project.",
            project.file,
          );
    if (
      project.diagnostics.some(
        (diagnostic) => diagnostic.category === "error" && diagnostic.file === null,
      )
    )
      for (const path of project.files)
        if (direct.has(path))
          unresolved(
            "compiler-configuration",
            path,
            "The effective compiler configuration has an error.",
            project.file,
          );
    for (const parameter of project.parameters) {
      for (const contract of contractTypes)
        if (
          parameter.types.some(
            (type) => type.file === contract.type.file && type.name === contract.type.name,
          )
        )
          direct.get(parameter.file)?.add(contract.capability);
      if (
        placement(parameter.file)?.[2] === "readings" &&
        (parameter.callable || parameter.accessor)
      )
        add(
          "R1",
          "reading-callable",
          parameter.file,
          "Pass data to this reading instead of supplied behavior.",
          parameter.name,
        );
    }
    for (const access of project.accesses) {
      if (!direct.has(access.file)) continue;
      if (access.kind === "clock" || access.kind === "randomness") {
        const kind = access.kind;
        const adapter = adapters.find(
          (row) =>
            row.kind === "external" &&
            pathOf(row.module) === access.file &&
            row.primitives?.includes(kind),
        );
        if (adapter === undefined) {
          direct.get(access.file)?.add(access.kind);
          rawFailures.add(`${access.file}:${access.kind}`);
          add(
            "R1",
            "raw-primitive",
            access.file,
            "Sample this operation only in its declared capability adapter.",
            access.kind,
          );
        }
      } else if (access.kind === "dynamic")
        unresolved(
          "authority-entry",
          access.file,
          "Dynamic code or ambient access has no supported authority identity.",
          `${access.kind}:${access.start}`,
        );
    }
    for (const global of project.globals) {
      if (!global.runtime || !direct.has(global.file)) continue;
      for (const adapter of adapters)
        if (adapter.globals?.includes(global.name)) {
          direct.get(global.file)?.add(adapter.capability);
          if (global.file !== pathOf(adapter.module)) {
            rawFailures.add(`${global.file}:${adapter.capability}`);
            add(
              "R1",
              "raw-primitive",
              global.file,
              "Acquire this ambient authority only through its declared capability adapter.",
              adapter.capability,
            );
          }
        }
    }
    for (const edge of project.imports) {
      const from = placement(edge.file);
      const to = edge.target === null ? null : placement(edge.target);
      if (from !== null && to !== null) {
        if (
          (from[2] === "adapters" && to[2] !== "primitives") ||
          (from[1] === to[1]
            ? !(
                from[2] === "compositions" ||
                to[2] === "primitives" ||
                (from[2] === "readings" && to[2] === "readings")
              )
            : from[1] === "core" || to[1] !== "core")
        )
          add(
            "R2",
            "layer-edge",
            edge.file,
            "Depend down or sideways within this zone, or inward on a public core contract.",
            edge.target ?? "",
          );
      }
      if (edge.typeOnly || !direct.has(edge.file)) continue;
      if (edge.target === null || !direct.has(edge.target)) {
        const packageName = edge.specifier.startsWith("@")
          ? edge.specifier.split("/").slice(0, 2).join("/")
          : edge.specifier.split("/")[0];
        const declaration = snapshot.config.packages?.find((row) => row.name === packageName);
        if (
          declaration !== undefined &&
          !edge.specifier.startsWith(".") &&
          !edge.specifier.startsWith("#")
        )
          for (const capability of declaration.capabilities) direct.get(edge.file)?.add(capability);
        else
          unresolved(
            "external-boundary",
            edge.file,
            "This runtime import has no classified local source or adapter authority.",
            edge.specifier,
          );
      }
    }
    for (const escape of project.escapes)
      if (direct.has(escape.file))
        add(
          "R1",
          "type-escape",
          escape.file,
          "Express this value through its checked type without an escape hatch.",
          `${escape.kind}:${escape.start}`,
        );
    for (const diagnostic of project.diagnostics)
      if (
        diagnostic.category === "error" &&
        diagnostic.file !== null &&
        direct.has(diagnostic.file)
      )
        add(
          "R1",
          "compiler",
          diagnostic.file,
          "Resolve this compiler diagnostic before claiming the boundary checked.",
          `${diagnostic.code}:${diagnostic.start}`,
        );
  }

  const inherited = new Map([...direct].map(([path, caps]) => [path, new Set(caps)]));
  const placedEdges: [string, string][] = [];
  for (const project of projects)
    for (const edge of project.imports)
      if (edge.target !== null && direct.has(edge.file) && direct.has(edge.target))
        placedEdges.push([edge.file, edge.target]);
  for (const cycle of cycles(placedEdges)) {
    const path = cycle[0];
    if (path !== undefined)
      add(
        "R2",
        "cycle",
        path,
        "Break this layered module import cycle through a shared lower contract.",
        cycle.join(","),
      );
  }
  const edges = projects
    .flatMap((project) => project.imports)
    .filter((edge) => !edge.typeOnly && edge.target !== null);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges)
      for (const capability of inherited.get(edge.target ?? "") ?? []) {
        const caps = inherited.get(edge.file);
        if (caps !== undefined && !caps.has(capability)) {
          caps.add(capability);
          changed = true;
        }
      }
  }
  const permits = (path: string, capability: string): boolean => {
    const zone = placement(path)?.[1];
    if (zone === undefined) return false;
    return adapters.some(
      (adapter) =>
        adapter.capability === capability &&
        adapter.zones.some((allowed) => allowed === zone) &&
        (zone !== "core" ||
          (adapter.kind === "produce" &&
            (adapter.primitives?.length ?? 0) === 0 &&
            (adapter.globals?.length ?? 0) === 0)),
    );
  };
  const connections = projects
    .flatMap((project) => project.connections)
    .filter(
      (connection) =>
        direct.has(connection.file) && connection.target !== null && direct.has(connection.target),
    );
  const keyOf = (input: { readonly file: string; readonly start: number }): string =>
    `${input.file}:${input.start}`;
  const bindings = connections.flatMap((connection) =>
    connection.callableOrigins.map((origin, index) => ({
      origin,
      source: connection.callableBindings?.[index]?.source ?? null,
      target: connection.callableBindings?.[index]?.target ?? null,
      supported: connection.callableBindings?.[index] !== undefined,
    })),
  );
  const inputs = new Map(
    projects.flatMap((project) =>
      project.parameters
        .filter((parameter) => parameter.callable || parameter.accessor)
        .map((parameter) => [keyOf(parameter), parameter.file] as const),
    ),
  );
  for (const binding of bindings)
    for (const input of [binding.source, binding.target])
      if (input !== null) inputs.set(keyOf(input), input.file);
  const known = new Set<string>();
  const suppliedCapabilities = new Map([...inputs.keys()].map((key) => [key, new Set<string>()]));
  for (const parameter of projects.flatMap((project) => project.parameters))
    for (const contract of contractTypes)
      if (
        parameter.types[0]?.file === contract.type.file &&
        parameter.types[0]?.name === contract.type.name
      ) {
        const key = keyOf(parameter);
        known.add(key);
        suppliedCapabilities.get(key)?.add(contract.capability);
      }
  const established = (binding: (typeof bindings)[number]): boolean =>
    binding.supported &&
    (binding.source !== null
      ? known.has(keyOf(binding.source))
      : binding.origin !== null &&
        inherited.has(binding.origin) &&
        [...inputs].every(([key, file]) => file !== binding.origin || known.has(key)));
  const bindingCapabilities = (binding: (typeof bindings)[number]): Set<string> =>
    new Set([
      ...(inherited.get(binding.origin ?? "") ?? []),
      ...(binding.source !== null
        ? (suppliedCapabilities.get(keyOf(binding.source)) ?? [])
        : [...inputs]
            .filter(([, file]) => file === binding.origin)
            .flatMap(([key]) => [...(suppliedCapabilities.get(key) ?? [])])),
    ]);
  changed = true;
  while (changed) {
    changed = false;
    for (const [key] of inputs) {
      const incoming = bindings.filter(
        (binding) =>
          binding.target !== null &&
          keyOf(binding.target) === key &&
          (binding.source === null || keyOf(binding.source) !== key),
      );
      if (!known.has(key) && incoming.length > 0 && incoming.every(established)) {
        known.add(key);
        changed = true;
      }
      for (const binding of incoming)
        for (const capability of bindingCapabilities(binding)) {
          const caps = suppliedCapabilities.get(key);
          if (caps !== undefined && !caps.has(capability)) {
            caps.add(capability);
            changed = true;
          }
        }
    }
  }
  const capabilityUniverse = new Set([
    ...adapters.map((adapter) => adapter.capability),
    ...[...inherited.values()].flatMap((capabilities) => [...capabilities]),
  ]);
  const restricted = (path: string): boolean =>
    placement(path)?.[1] === "core" ||
    placement(path)?.[2] === "readings" ||
    [...capabilityUniverse].some((capability) => !permits(path, capability));
  for (const [path, caps] of inherited) {
    if (placement(path) === null) continue;
    for (const capability of caps) {
      if (placement(path)?.[2] === "readings")
        add(
          "R1",
          "reading-authority",
          path,
          permits(path, capability)
            ? "Move this capability out of the reading and supply its result as data."
            : "Move this capability to a permitted zone outside the reading and supply its result as data.",
          capability,
        );
      if (
        !permits(path, capability) &&
        placement(path)?.[2] !== "readings" &&
        !rawFailures.has(`${path}:${capability}`)
      )
        add(
          "R1",
          "zone-authority",
          path,
          "Connect this capability in a zone permitted to use it.",
          capability,
        );
    }
  }
  for (const project of projects) {
    for (const construction of project.constructions) {
      if (!direct.has(construction.file)) continue;
      const description = descriptions.find((adapter) =>
        construction.types.some(
          (type) => type.file === adapter.type.file && type.name === adapter.type.name,
        ),
      );
      if (description !== undefined) {
        if (!(inherited.get(construction.file)?.has(description.capability) ?? false))
          add(
            "R2",
            "write-construction",
            construction.file,
            "Construct this description only with its production capability.",
            String(construction.start),
          );
        if (construction.callable)
          add(
            "R1",
            "description-callable",
            construction.file,
            "Describe the operation and its arguments as data rather than a closure.",
            String(construction.start),
          );
      }
    }
    for (const connection of project.connections) {
      if (!direct.has(connection.file)) continue;
      if (connection.target === null || placement(connection.target) === null) continue;
      for (const [index, origin] of connection.callableOrigins.entries()) {
        const binding = {
          origin,
          source: connection.callableBindings?.[index]?.source ?? null,
          target: connection.callableBindings?.[index]?.target ?? null,
          supported: connection.callableBindings?.[index] !== undefined,
        };
        if (!established(binding) && restricted(connection.target))
          unresolved(
            "callable-binding",
            connection.file,
            "The supplied executable input has no established capability boundary.",
            `${connection.target}:${connection.start}`,
          );
        if (origin === null) continue;
        for (const capability of bindingCapabilities(binding))
          if (
            !permits(connection.target, capability) ||
            placement(connection.target)?.[2] === "readings"
          )
            add(
              "R1",
              "closure-binding",
              connection.file,
              "Connect this callable only where its creation capabilities are permitted.",
              `${connection.target}:${connection.start}:${capability}`,
            );
      }
    }
  }
  return {
    requirements: [...inherited].map(([path, caps]) => ({
      path,
      direct: [...(direct.get(path) ?? [])].sort(),
      inherited: [...caps].sort(),
    })),
    findings: [
      ...new Map(findings.map((result) => [`${result.debtKey}:${result.path}`, result])).values(),
    ].sort(byDebtKey),
  };
}
import { LAYERS } from "../primitives/layer.js";
import type { Snapshot } from "../primitives/snapshot.js";

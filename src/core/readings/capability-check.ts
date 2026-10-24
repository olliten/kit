import { cycles } from "./dependency-check.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { legacyCodeOf, moduleFileOf, placementOf, rootOf } from "./placement-of.js";

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
  const roots = snapshot.config.srcRoot;
  rootOf("", roots);
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
            typeof roots === "string" ? roots : roots.join(","),
            "Declare one distinct directory name for each of the four layers.",
          ),
          status: "unresolved",
          blocking: true,
          limit: "Ambiguous or non-directory names cannot establish module placement.",
          category: "checker-limit",
        },
      ],
    };
  const placement = (path: string) => {
    const at = placementOf(path, snapshot.config.srcRoot, snapshot.config.layerNames);
    return at.placed ? at : null;
  };
  const files = snapshot.files
    .filter(
      (file) =>
        (file.type === "source" ||
          (file.type === "test" && snapshot.config.exceptions?.includes(file.path))) &&
        (rootOf(file.path, roots) !== undefined || legacyCodeOf(file.path, snapshot.config.layout?.legacy)),
    )
    .map((file) => file.path);
  const zoneOf = (path: string): string | undefined => {
    const root = rootOf(path, roots);
    if (root === undefined && !legacyCodeOf(path, snapshot.config.layout?.legacy)) return undefined;
    const zone = root === undefined ? undefined : path.slice(root.length + 1).split("/")[0];
    if (zone === "core" || zone === "shell" || zone === "substrate") return zone;
    return snapshot.config.legacyZones?.find((row) =>
      "files" in row
        ? row.files.includes(path) && placement(path) === null
        : path.startsWith(`${row.root.replace(/\/$/, "")}/`),
    )?.zone;
  };
  const adapters = snapshot.config.adapters ?? [];
  const packages = snapshot.config.packages ?? [];
  for (const row of packages) {
    if (row.entrypointExports === undefined) continue;
    if (
      !row.name ||
      row.name.trim() !== row.name ||
      /^[.#/]/.test(row.name) ||
      !Array.isArray(row.capabilities) ||
      row.capabilities.length === 0 ||
      Array.from(row.capabilities).some(
        (capability) => typeof capability !== "string" || !capability.trim(),
      ) ||
      !Array.isArray(row.entrypointExports) ||
      row.entrypointExports.length === 0 ||
      Array.from(row.entrypointExports).some(
        (name) => typeof name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(name),
      ) ||
      new Set(row.entrypointExports).size !== row.entrypointExports.length ||
      packages.filter((other) => other.name === row.name).length !== 1
    )
      throw new Error("Declare one effectful entrypoint package contract with distinct named exports.");
  }
  const pathOf = (module: string): string => moduleFileOf(module, roots, snapshot.config.layerNames);
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
      fact.type === null ||
      (adapter.kind === "external" && fact.parameter !== null &&
        !files.includes(fact.type.file) && fact.nativeAuthority?.some((authority) =>
          authority.root.file === fact.type?.file && authority.root.name === fact.type?.name))
        ? []
        : [
            { capability: adapter.capability, type: fact.type, kind: adapter.kind },
            // A port the contract returns carries the same capability, and no other.
            ...(adapter.kind === "external" && fact.parameter === null ? (fact.ports ?? []) : []).map((port) => ({
              capability: adapter.capability,
              type: port,
              kind: adapter.kind,
            })),
          ],
    ),
  );
  // The installed package a declaration file belongs to, as an adapter's accepted types name it.
  const packageOf = (file: string): string | undefined => {
    const at = file.lastIndexOf("node_modules/");
    if (at < 0) return undefined;
    const parts = file.slice(at + "node_modules/".length).split("/");
    return parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  };
  for (const adapter of adapters)
    for (const accepted of adapter.accepts ?? [])
      if (
        adapter.kind !== "external" ||
        typeof accepted.package !== "string" ||
        !accepted.package.trim() ||
        /^[.#/]/.test(accepted.package) ||
        !packages.some((row) => row.name === accepted.package) ||
        !Array.isArray(accepted.types) ||
        accepted.types.length === 0 ||
        Array.from(accepted.types).some((name) => typeof name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(name)) ||
        new Set(accepted.types).size !== accepted.types.length
      )
        throw new Error(
          "Declare accepts only on an external adapter, as a declared package and its distinct named handle types.",
        );
  const accepting = (path: string, type: { readonly file: string; readonly name: string } | undefined) =>
    adapters.find(
      (adapter) =>
        adapter.kind === "external" &&
        pathOf(adapter.module) === path &&
        type !== undefined &&
        (adapter.accepts ?? []).some(
          (accepted) => accepted.types.includes(type.name) && packageOf(type.file) === accepted.package,
        ),
    );
  const sdkInputs = adapters.flatMap((adapter) =>
    adapter.kind !== "external" ? [] :
      (contracts.get(adapter) ?? []).flatMap((fact) =>
        fact.parameter === null || fact.type === null || files.includes(fact.type.file) ||
        !fact.nativeAuthority?.some((authority) =>
          authority.root.file === fact.type?.file && authority.root.name === fact.type?.name)
          ? [] : [{ file: pathOf(adapter.module), type: fact.type }],
      ),
  );
  // The native roots an accepted handle reaches through its own type graph, as the compiler resolved them at the
  // accepting adapter's parameters: the accepted types and the host types their members mention, nothing else.
  const acceptedCache = new Map<(typeof adapters)[number], Set<string>>();
  const acceptedRoots = (adapter: (typeof adapters)[number]): Set<string> => {
    const cached = acceptedCache.get(adapter);
    if (cached !== undefined) return cached;
    const roots = new Set(
      (adapter.accepts ?? []).length === 0
        ? []
        : (snapshot.compiler?.projects ?? []).flatMap((project) =>
            project.parameters
              .filter((parameter) => accepting(pathOf(adapter.module), parameter.types[0]) === adapter)
              .flatMap((parameter) =>
                (parameter.nativeAuthority ?? []).flatMap((authority) => [
                  nativeKey(authority.root),
                  ...(authority.windowOnly === true ? [windowAuthority] : []),
                ]),
              ),
          ),
    );
    acceptedCache.set(adapter, roots);
    return roots;
  };
  const externalAdapterPaths = new Set(
    adapters
      .filter((adapter) => adapter.kind === "external")
      .map((adapter) => pathOf(adapter.module)),
  );
  const nativeKey = (identity: { readonly file: string; readonly name: string }): string =>
    `native:${identity.file}:${identity.name}`;
  const nativeAuthorities = new Map(
    projects.flatMap((project) =>
      [
        ...project.parameters,
        ...project.accesses,
        ...project.globals,
        ...project.connections.flatMap((connection) =>
          (connection.callableBindings ?? []).flatMap((binding) =>
            binding.capture === undefined ? [] : [binding.capture],
          ),
        ),
      ].flatMap((entry) =>
        (entry.nativeAuthority ?? []).map(
          (authority) => [nativeKey(authority.root), authority] as const,
        ),
      ),
    ),
  );
  // Each capability a fact grants at its position, so a callable is charged only the code it reaches.
  const positioned = new Map<string, string[]>();
  const windowAuthority = "host:window";
  const grantAt = (file: string, start: number, capability: string): void => {
    const key = `${file}:${start}`;
    const list = positioned.get(key);
    const granted = nativeAuthorities.get(capability)?.windowOnly === true
      ? [capability, windowAuthority]
      : [capability];
    if (list === undefined) positioned.set(key, granted);
    else list.push(...granted);
  };

  const direct = new Map(files.map((path) => [path, new Set<string>()]));
  const internalNative = new Map(
    [...externalAdapterPaths].map((path) => [path, new Set<string>()]),
  );
  const recordNative = (path: string, capability: string): void => {
    (internalNative.get(path) ?? direct.get(path))?.add(capability);
    if (nativeAuthorities.get(capability)?.windowOnly === true)
      direct.get(path)?.add(windowAuthority);
  };
  const findings: CapabilityFinding[] = [];
  const startups = new Set<string>();
  const rawFailures = new Set<string>();
  const crossZoneFailures = new Set<string>();
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
          : placement(path) === null && !startups.has(path)
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
  for (const path of snapshot.config.exceptions ?? []) {
    if (rootOf(path, roots) === undefined && !legacyCodeOf(path, snapshot.config.layout?.legacy)) continue;
    if (
      !files.includes(path) ||
      /[*?{}[\]\\]/.test(path) ||
      path.split("/").some((part) => part === "." || part === ".." || part === "") ||
      placement(path) !== null ||
      zoneOf(path) !== undefined
    ) {
      add(
        "R2",
        "startup-placement",
        path,
        "Declare only an exact existing executable entrypoint outside every zone.",
        path,
        "unresolved",
        true,
        "Directory, pattern, missing-code and zoned-module exceptions grant no entrypoint permission.",
      );
      continue;
    }
    startups.add(path);
  }
  // A files row zones only what it lists, and each listed file is debt, so the baseline records the row's
  // set: dropping a file shrinks it, and a file added to it is new debt the ratchet rejects.
  for (const row of snapshot.config.legacyZones ?? [])
    if ("files" in row)
      for (const path of row.files)
        if (files.includes(path) && placement(path) === null)
          add(
            "R1",
            "legacy-zone",
            path,
            "Place this module, then remove it from its legacy zone row.",
            row.zone,
          );
        else
          add(
            "R1",
            "legacy-zone-row",
            path,
            "List only existing legacy source files in a legacy zone row.",
            row.zone,
          );
  if (projects.length === 0)
    for (const path of files)
      unresolved("compiler-boundary", path, "No compiler project covers the source.");
  else
    for (const path of files)
      if (
        !projects.some(
          (project) => project.files.includes(path) || project.ambientFiles.includes(path),
        )
      )
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
    if (adapter.kind === "external" && placement(path)?.layer !== "adapters")
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
      for (const authority of parameter.nativeAuthority ?? []) {
        recordNative(parameter.file, nativeKey(authority.root));
        grantAt(parameter.file, parameter.start, nativeKey(authority.root));
      }
      for (const contract of contractTypes)
        if (
          (contract.kind !== "produce" || parameter.callable || parameter.accessor) &&
          parameter.types.some(
            (type) => type.file === contract.type.file && type.name === contract.type.name,
          )
        ) {
          direct.get(parameter.file)?.add(contract.capability);
          grantAt(parameter.file, parameter.start, contract.capability);
        }
      if (
        parameter.exported !== false &&
        placement(parameter.file)?.layer === "readings" &&
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
      if (access.kind === "native")
        for (const authority of access.nativeAuthority ?? [])
          grantAt(access.file, access.start, nativeKey(authority.root));
      if (!direct.has(access.file)) continue;
      if (access.kind === "native") {
        for (const authority of access.nativeAuthority ?? [])
          recordNative(access.file, nativeKey(authority.root));
        if ((access.nativeAuthority ?? []).length === 0)
          unresolved(
            "native-authority",
            access.file,
            "The native executable member has no supported receiver identity.",
            `${access.start}`,
          );
      } else if (access.kind === "clock" || access.kind === "randomness") {
        const kind = access.kind;
        const adapter = adapters.find(
          (row) =>
            row.kind === "external" &&
            pathOf(row.module) === access.file &&
            row.primitives?.includes(kind),
        );
        if (adapter === undefined) {
          direct.get(access.file)?.add(access.kind);
          grantAt(access.file, access.start, access.kind);
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
    const hostGlobals = new Set<string>();
    for (const global of project.globals) {
      if (!global.runtime || !direct.has(global.file)) continue;
      // An installed package's ambient global, such as Node's process or require, reaches the host
      // without any import, so only an adapter that declares it may use it.
      const name = global.name.startsWith("globalThis.")
        ? global.name.slice("globalThis.".length)
        : global.name;
      const declared = global.declarationFile ?? "";
      if (
        !name.includes(".") &&
        global.value !== true &&
        /(?:^|\/)node_modules\//.test(declared) &&
        !/(?:^|\/)node_modules\/typescript\/lib\//.test(declared) &&
        !adapters.some((adapter) => adapter.globals?.includes(name)) &&
        !hostGlobals.has(`${global.file}:${name}`)
      ) {
        hostGlobals.add(`${global.file}:${name}`);
        unresolved(
          "ambient-global",
          global.file,
          "This ambient global from an installed package has no declared capability adapter.",
          name,
        );
      }
      const declaredAdapters = adapters.filter((adapter) =>
        adapter.globals?.includes(global.name),
      );
      const owners = declaredAdapters.filter((adapter) => pathOf(adapter.module) === global.file);
      if (externalAdapterPaths.has(global.file) || declaredAdapters.length === 0)
        for (const authority of global.nativeAuthority ?? []) {
          recordNative(global.file, nativeKey(authority.root));
          grantAt(global.file, global.start, nativeKey(authority.root));
        }
      for (const adapter of owners.length > 0 ? owners : declaredAdapters) {
        direct.get(global.file)?.add(adapter.capability);
        grantAt(global.file, global.start, adapter.capability);
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
      if (edge.target !== null && startups.has(edge.target) && direct.has(edge.file))
        add(
          "R2",
          "startup-import",
          edge.file,
          "Keep executable entrypoints outside the imported module graph.",
          edge.target,
        );
      if (
        startups.has(edge.file) &&
        edge.target !== null &&
        direct.has(edge.target) &&
        zoneOf(edge.target) === undefined
      )
        unresolved(
          "migration-zone",
          edge.file,
          "Startup wiring does not establish a zone for its dependencies.",
          edge.target,
        );
      if (from !== null && to !== null) {
        if (
          (from.layer === "adapters" && to.layer !== "primitives") ||
          (from.zone === to.zone
            ? !(
                from.layer === "compositions" ||
                to.layer === "primitives" ||
                (from.layer === "readings" && to.layer === "readings")
              )
            : from.zone === "core" || to.zone !== "core")
        )
          add(
            "R2",
            "layer-edge",
            edge.file,
            "Depend down or sideways within this zone, or inward on a public core contract.",
            edge.target ?? "",
          );
      }
      if (
        edge.target !== null &&
        direct.has(edge.file) &&
        direct.has(edge.target) &&
        !startups.has(edge.file) &&
        !startups.has(edge.target) &&
        (from === null) !== (to === null)
      ) {
        const fromZone = zoneOf(edge.file);
        const toZone = zoneOf(edge.target);
        if (fromZone === undefined || toZone === undefined)
          unresolved(
            "migration-zone",
            edge.file,
            "Declare the legacy prefix's actual zone before establishing this cross-placement boundary.",
            edge.target,
          );
        else if (fromZone !== toZone && (fromZone === "core" || toZone !== "core")) {
          crossZoneFailures.add(`${edge.file}:${edge.target}`);
          add(
            "R2",
            "zone-edge",
            edge.file,
            "Keep cross-placement imports in the same zone or point inward to core; legacy placement grants no outer-zone access.",
            edge.target,
          );
        }
      }
      if (edge.typeOnly || !direct.has(edge.file)) continue;
      if (edge.target === null || !direct.has(edge.target)) {
        const packageName = edge.specifier.startsWith("@")
          ? edge.specifier.split("/").slice(0, 2).join("/")
          : edge.specifier.split("/")[0];
        const declaration = snapshot.config.packages?.find((row) => row.name === packageName);
        const bound = adapters.filter(
          (adapter) =>
            adapter.kind === "external" &&
            packageName !== undefined &&
            adapter.packages?.includes(packageName) === true,
        );
        const owners = bound.filter((adapter) => pathOf(adapter.module) === edge.file);
        if (bound.length > 0 && !edge.specifier.startsWith(".") && !edge.specifier.startsWith("#")) {
          // An adapter's package is its raw operation: binding it to the adapter's row is what keeps
          // the core and the adapter's neighbours from reaching it, whatever a package row says.
          for (const adapter of owners.length > 0 ? owners : bound) {
            direct.get(edge.file)?.add(adapter.capability);
            if (owners.length === 0) rawFailures.add(`${edge.file}:${adapter.capability}`);
          }
          if (owners.length === 0)
            add(
              "R1",
              "package-import",
              edge.file,
              "Import this package only in the capability adapter that declares it, and use that adapter's contract here.",
              packageName,
            );
        } else if (declaration?.entrypointExports !== undefined) {
          if (
            startups.has(edge.file) &&
            edge.specifier === declaration.name &&
            edge.namedImports !== undefined &&
            edge.namedImports !== null &&
            edge.namedImports.length > 0 &&
            Array.from(edge.namedImports).every((name) => declaration.entrypointExports?.includes(name))
          ) {
            for (const capability of declaration.capabilities) direct.get(edge.file)?.add(capability);
          } else
            unresolved(
              "entrypoint-package",
              edge.file,
              "This package contract permits only selected named runtime exports in an exact declared entrypoint.",
              edge.specifier,
            );
        } else if (
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
          `${escape.kind}:${escape.site ?? escape.start}`,
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
  const coreProducer = (adapter: (typeof adapters)[number]): boolean =>
    adapter.kind === "produce" &&
    placement(pathOf(adapter.module))?.zone === "core" &&
    placement(pathOf(adapter.module))?.layer === "compositions" &&
    adapter.zones.includes("core") &&
    (adapter.primitives?.length ?? 0) === 0 &&
    (adapter.globals?.length ?? 0) === 0;
  const permits = (path: string, capability: string): boolean => {
    if (
      startups.has(path) &&
      packages.some((row) => row.entrypointExports !== undefined && row.capabilities.includes(capability))
    )
      return true;
    const zone = zoneOf(path);
    const permittedZones = startups.has(path)
      ? ["shell", "substrate"]
      : zone === undefined
        ? []
        : [zone];
    if (permittedZones.length === 0) return false;
    if (capability === windowAuthority) return permittedZones.includes("shell");
    const native = nativeAuthorities.get(capability);
    if (native?.windowOnly === true && !permittedZones.includes("shell")) return false;
    if (native !== undefined)
      return (
        permittedZones.some((allowed) => allowed !== "core") &&
        placement(path)?.layer !== "readings" &&
        adapters.some(
          (adapter) =>
            adapter.kind === "external" &&
            adapter.zones.some(
              (allowed) => allowed !== "core" && permittedZones.includes(allowed),
            ) &&
            contracts
              .get(adapter)
              ?.some((contract) =>
                (contract.nativeAuthority ?? []).some(
                  (accepted) =>
                    native.root.file === accepted.root.file &&
                    native.root.name === accepted.root.name,
                ),
              ),
        )
      );
    return adapters.some(
      (adapter) =>
        adapter.capability === capability &&
        (adapter.kind === "produce"
          ? coreProducer(adapter) &&
            (placement(path)?.layer === "compositions" || placement(path) === null)
          : adapter.zones.some(
              (allowed) => allowed !== "core" && permittedZones.includes(allowed),
            )),
    );
  };
  // A declared host global is a door: every handle an adapter reaches through it, such as the elements
  // behind document or the response behind fetch, belongs to the same host library and is the adapter's to
  // hold. Its contract decides what leaves.
  const hostLibrary = /(?:^|\/)lib\.dom(?:\.[\w-]+)*\.d\.ts$/;
  const declaresHostGlobal = (adapter: (typeof adapters)[number], path: string): boolean =>
    projects.some((project) =>
      project.globals.some(
        (global) =>
          global.file === path &&
          global.runtime &&
          adapter.globals?.includes(global.name) === true &&
          hostLibrary.test(global.declarationFile ?? ""),
      ),
    );
  for (const [path, capabilities] of internalNative)
    for (const capability of capabilities) {
      const native = nativeAuthorities.get(capability);
      if (native === undefined) continue;
      const allowed = adapters.some(
        (adapter) =>
          pathOf(adapter.module) === path &&
          adapter.kind === "external" &&
          ((hostLibrary.test(native.root.file) && declaresHostGlobal(adapter, path)) ||
          // The adapter's own Window-only access needs a declared global, whatever its handles' types mention.
          (acceptedRoots(adapter).has(capability) && native.windowOnly !== true) ||
          [
            ...(contracts.get(adapter) ?? []).flatMap((contract) => contract.nativeAuthority ?? []),
            ...projects.flatMap((project) =>
              project.globals.flatMap((global) =>
                global.file === path && global.runtime && adapter.globals?.includes(global.name)
                  ? (global.nativeAuthority ?? [])
                  : [],
              ),
            ),
          ].some(
            (accepted) =>
              native.root.file === accepted.root.file && native.root.name === accepted.root.name,
          )),
      );
      if (!allowed)
        unresolved(
          "native-authority",
          path,
          "This adapter's native SDK authority is outside its contract and declared globals.",
          capability,
        );
    }
  const connections = projects
    .flatMap((project) => project.connections)
    .filter(
      (connection) =>
        direct.has(connection.file) && connection.target !== null && direct.has(connection.target),
    );
  const keyOf = (input: { readonly file: string; readonly start: number }): string =>
    `${input.file}:${input.start}`;
  const bindingOf = (
    connection: (typeof connections)[number],
    index: number,
  ): {
    readonly origin: string | null;
    readonly source: { readonly file: string; readonly start: number } | null;
    readonly target: { readonly file: string; readonly start: number } | null;
    readonly supported: boolean;
    readonly capture: NonNullable<typeof connection.callableBindings>[number]["capture"];
    // The module the value is handed to.
    readonly into: string | null;
  } => ({
    origin: connection.callableOrigins[index] ?? null,
    source: connection.callableBindings?.[index]?.source ?? null,
    target: connection.callableBindings?.[index]?.target ?? null,
    supported: connection.callableBindings?.[index] !== undefined,
    capture: connection.callableBindings?.[index]?.capture,
    into: connection.target,
  });
  const bindings = connections.flatMap((connection) =>
    connection.callableOrigins.map((_, index) => bindingOf(connection, index)),
  );
  const parameterExecutability = new Map(
    projects.flatMap((project) =>
      project.parameters.map((parameter) => [keyOf(parameter), parameter.executable] as const),
    ),
  );
  const inputs = new Map(
    projects.flatMap((project) =>
      project.parameters
        .filter((parameter) => parameter.executable ?? (parameter.callable || parameter.accessor))
        .map((parameter) => [keyOf(parameter), parameter.file] as const),
    ),
  );
  for (const binding of bindings)
    for (const input of [binding.source, binding.target])
      if (input !== null && parameterExecutability.get(keyOf(input)) !== false)
        inputs.set(keyOf(input), input.file);
  const known = new Set<string>();
  const suppliedCapabilities = new Map([...inputs.keys()].map((key) => [key, new Set<string>()]));
  for (const parameter of projects.flatMap((project) => project.parameters)) {
    for (const contract of contractTypes)
      if (
        (contract.kind !== "produce" || parameter.callable || parameter.accessor) &&
        parameter.types[0]?.file === contract.type.file &&
        parameter.types[0]?.name === contract.type.name
      ) {
        const key = keyOf(parameter);
        known.add(key);
        suppliedCapabilities.get(key)?.add(contract.capability);
      }
    for (const input of sdkInputs)
      if (parameter.types[0]?.file === input.type.file && parameter.types[0]?.name === input.type.name) {
        const key = keyOf(parameter);
        known.add(key);
        suppliedCapabilities.get(key)?.add(nativeKey(input.type));
      }
  }
  // A value bound to a parameter typed as a registered adapter's contract or port, or to a package handle an
  // adapter accepts, is that adapter's: the binding is established and carries exactly its capability. A
  // literal or closure supplied there is still judged by what it captures.
  const held = new Map<string, (typeof adapters)[number]>();
  for (const parameter of projects.flatMap((project) => project.parameters)) {
    const type = parameter.types[0];
    const contract = contractTypes.find(
      (candidate) =>
        candidate.kind !== "produce" && type?.file === candidate.type.file && type?.name === candidate.type.name,
    );
    const owner = accepting(parameter.file, type);
    const holder = contract === undefined ? owner : adapters.find((adapter) =>
      adapter.kind === "external" && adapter.capability === contract.capability &&
      (contracts.get(adapter) ?? []).some((fact) => fact.type !== null &&
        [fact.type, ...(fact.ports ?? [])].some((port) => port.file === type?.file && port.name === type?.name)));
    if (holder !== undefined) held.set(keyOf(parameter), holder);
  }
  const parameterFacts = new Map(
    projects.flatMap((project) => project.parameters.map((parameter) => [keyOf(parameter), parameter] as const)),
  );
  // The handle a binding passes: the caller's own parameter, named directly or as the one value its argument uses.
  const passed = (binding: (typeof bindings)[number]) => {
    const source = binding.source ?? (binding.capture?.parameters.length === 1 ? binding.capture.parameters[0] : undefined);
    return source === undefined ? undefined : parameterFacts.get(keyOf(source));
  };
  const heldBy = (binding: (typeof bindings)[number]) =>
    !binding.supported
      ? undefined
      : ((binding.target === null ? undefined : held.get(keyOf(binding.target))) ??
        accepting(binding.into ?? "", passed(binding)?.types[0]));
  // What a held value brings beyond its adapter: the adapter's own authority and the roots of the handle types it
  // accepts are its; anything else captured, a host global included, stays the caller's and is checked.
  const beyond = (binding: (typeof bindings)[number], holder: (typeof adapters)[number]): string[] => {
    const own = inherited.get(pathOf(holder.module)) ?? new Set<string>();
    // A root the caller's own code reaches, such as a captured window, is the caller's even when the handle's
    // type mentions it too.
    const brought = new Set(
      (binding.capture?.positions ?? [])
        .filter((position) => !adapterPaths.has(position.file))
        .flatMap((position) => positioned.get(`${position.file}:${position.start}`) ?? []),
    );
    return [...(binding.capture === undefined ? [] : captured(binding.capture))].filter((capability) => {
      return !own.has(capability) && (!acceptedRoots(holder).has(capability) || brought.has(capability));
    });
  };
  const heldCarry = (binding: (typeof bindings)[number]): string[] | undefined => {
    const holder = heldBy(binding);
    return holder === undefined ? undefined : [holder.capability, ...beyond(binding, holder)];
  };
  const established = (binding: (typeof bindings)[number]): boolean =>
    heldCarry(binding)?.length === 1 ||
    binding.supported &&
    (binding.capture === undefined || binding.capture.parameters.every(
      (parameter) => !inputs.has(keyOf(parameter)) || known.has(keyOf(parameter)),
    )) &&
    (binding.source !== null
      ? known.has(keyOf(binding.source))
      : binding.origin !== null &&
        inherited.has(binding.origin) &&
        // A reading keeps every binding: what it hands on is checked by its file's inputs, captured or not.
        (binding.capture === undefined || placement(binding.origin)?.layer === "readings"
          ? [...inputs].every(([key, file]) => file !== binding.origin || known.has(key))
          : binding.capture.parameters.every(
              (parameter) => !inputs.has(keyOf(parameter)) || known.has(keyOf(parameter)),
            )));
  // A file a callable reaches only in part grants what its reached code grants; an adapter's file, or
  // one the capture could not follow, is charged whole.
  const adapterPaths = new Set(adapters.map((adapter) => pathOf(adapter.module)));
  const capturedCapabilities = new Map<object, readonly string[]>();
  const captured = (capture: NonNullable<(typeof bindings)[number]["capture"]>): readonly string[] => {
    const cached = capturedCapabilities.get(capture);
    if (cached !== undefined) return cached;
    const whole = (file: string): readonly string[] => [...(inherited.get(file) ?? [])];
    const grants = (position: { readonly file: string; readonly start: number }): readonly string[] =>
      positioned.get(`${position.file}:${position.start}`) ?? [];
    const result = [
      ...new Set([
        ...capture.reached.filter((file) => adapterPaths.has(file)).flatMap(whole),
        ...capture.positions
          .filter((position) => !adapterPaths.has(position.file))
          .flatMap(grants),
        ...capture.whole.flatMap(whole),
        ...capture.packages.flatMap((specifier) => {
          const name = specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0];
          // A package an adapter declares is that adapter's capability, as at its import.
          const bound = adapters.filter(
            (adapter) =>
              adapter.kind === "external" &&
              name !== undefined &&
              adapter.packages?.includes(name) === true,
          );
          return bound.length > 0
            ? bound.map((adapter) => adapter.capability)
            : (snapshot.config.packages?.find((row) => row.name === name)?.capabilities ?? []);
        }),
        ...capture.parameters.flatMap(grants),
        ...contractTypes
          .filter(
            (contract) =>
              contract.kind !== "produce" &&
              capture.types.some(
                (type) => type.file === contract.type.file && type.name === contract.type.name,
              ),
          )
          .map((contract) => contract.capability),
        ...capture.nativeAuthority.flatMap((authority) => [
          nativeKey(authority.root),
          ...(authority.windowOnly === true ? [windowAuthority] : []),
        ]),
      ]),
    ];
    capturedCapabilities.set(capture, result);
    return result;
  };
  const bindingCapabilities = (binding: (typeof bindings)[number]): Set<string> =>
    new Set(
      heldCarry(binding) !== undefined
        ? (heldCarry(binding) ?? [])
        : binding.capture !== undefined
        ? [
            ...captured(binding.capture),
            ...binding.capture.parameters.flatMap((parameter) => [
              ...(suppliedCapabilities.get(keyOf(parameter)) ?? []),
            ]),
          ]
        : [
            ...(inherited.get(binding.origin ?? "") ?? []),
            ...(binding.source !== null
              ? (suppliedCapabilities.get(keyOf(binding.source)) ?? [])
              : [...inputs]
                  .filter(([, file]) => file === binding.origin)
                  .flatMap(([key]) => [...(suppliedCapabilities.get(key) ?? [])])),
          ],
    );
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
    startups.has(path) ||
    placement(path)?.zone === "core" ||
    placement(path)?.layer === "readings" ||
    [...capabilityUniverse].some((capability) => !permits(path, capability));
  const nativeFailures = new Set<string>();
  for (const [path, caps] of inherited) {
    if (placement(path) === null && !startups.has(path)) continue;
    for (const capability of caps) {
      if (capability === windowAuthority && !permits(path, capability)) {
        add(
          "R1", "window-authority", path,
          "Keep Window-only host authority in Shell; adapter declarations cannot grant it to another zone.",
        );
        continue;
      }
      if (nativeAuthorities.has(capability)) {
        if (!permits(path, capability)) {
          nativeFailures.add(`${path}:${capability}`);
          unresolved(
            "native-authority",
            path,
            "This native SDK handle grants authority outside a matching permitted adapter boundary.",
            capability,
          );
        }
        continue;
      }
      if (placement(path)?.layer === "readings")
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
        placement(path)?.layer !== "readings" &&
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
  for (const edge of edges) {
    if (crossZoneFailures.has(`${edge.file}:${edge.target}`)) continue;
    if (placement(edge.file) !== null || edge.target === null || placement(edge.target) === null)
      continue;
    if (zoneOf(edge.file) === undefined) continue;
    for (const capability of inherited.get(edge.target) ?? []) {
      if (permits(edge.file, capability) || rawFailures.has(`${edge.file}:${capability}`)) continue;
      if (nativeAuthorities.has(capability))
        unresolved(
          "native-authority",
          edge.file,
          "This cross-placement dependency grants native authority outside its legacy zone's permitted capability boundary.",
          capability,
        );
      else
        add(
          "R1",
          "zone-authority",
          edge.file,
          "Supply data across this boundary instead of importing a capability the legacy zone does not permit.",
          capability,
        );
    }
  }
  for (const project of projects) {
    for (const construction of project.constructions) {
      if (!direct.has(construction.file)) continue;
      const matchingDescriptions = descriptions.filter((adapter) =>
        construction.types.some(
          (type) => type.file === adapter.type.file && type.name === adapter.type.name,
        ),
      );
      if (matchingDescriptions.length > 0) {
        if (
          !matchingDescriptions.some(
            (adapter) => coreProducer(adapter) && construction.file === pathOf(adapter.module),
          )
        )
          add(
            "R2",
            "write-construction",
            construction.file,
            "Construct this description only in its declared Core producer.",
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
      // A composition or registered external adapter handing a handle to a function only it can name
      // crosses no module boundary. Its own authority and every connection out remain checked.
      if (
        connection.local === true &&
        (placement(connection.file)?.layer === "compositions" ||
          externalAdapterPaths.has(connection.file))
      )
        continue;
      const invocation = adapters.some(
        (adapter) => adapter.kind === "external" && pathOf(adapter.module) === connection.target,
      )
        ? connection.file
        : connection.target;
      const relocated = placement(connection.file) === null;
      const boundary = relocated
        ? placement(invocation) === null
          ? connection.target
          : invocation
        : connection.file;
      const detail = `${relocated ? `${connection.file}:` : ""}${connection.target}:${connection.start}`;
      for (const [index, origin] of connection.callableOrigins.entries()) {
        const binding = bindingOf(connection, index);
        if (
          !established(binding) && (restricted(connection.target) ||
            sdkInputs.some((input) => input.file === connection.target))
        )
          unresolved(
            "callable-binding",
            boundary,
            relocated
              ? `The executable input supplied by ${connection.file} has no established capability boundary.`
              : "The supplied executable input has no established capability boundary.",
            detail,
          );
        if (origin === null && binding.capture === undefined) continue;
        for (const capability of bindingCapabilities(binding)) {
          // An accepted handle handed to its adapter is that adapter's to hold, not its caller's to grant.
          if (capability === heldBy(binding)?.capability && pathOf(heldBy(binding)?.module ?? "") === connection.target) continue;
          if (nativeAuthorities.has(capability)) {
            const receiver = sdkInputs.some((input) =>
              input.file === connection.target && nativeKey(input.type) === capability,
            ) ? connection.target : invocation;
            if (
              !permits(receiver, capability) &&
              !nativeFailures.has(`${connection.file}:${capability}`)
            )
              unresolved(
                "native-authority",
                boundary,
                relocated
                  ? `The callable supplied by ${connection.file} retains native SDK authority outside this boundary's matching permitted adapter contract.`
                  : "This callable retains native SDK authority outside a matching permitted adapter boundary.",
                `${detail}:${capability}`,
              );
            continue;
          }
          if (
            !permits(invocation, capability) ||
            placement(connection.target)?.layer === "readings"
          )
            add(
              "R1",
              "closure-binding",
              boundary,
              relocated
                ? `Connect the callable supplied by ${connection.file} only where its creation capabilities are permitted.`
                : "Connect this callable only where its creation capabilities are permitted.",
              `${detail}:${capability}`,
            );
        }
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

import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import type { Snapshot } from "../../src/core/primitives/snapshot.js";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { authorityGraph } from "../../src/core/readings/authority-graph.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { edgeCheck } from "../../src/core/readings/edge-check.js";
import { globalAuthority } from "../../src/core/readings/global-authority.js";
import { importAuthority } from "../../src/core/readings/import-authority.js";
import { placementOf } from "../../src/core/readings/placement-of.js";
import { startupCheck } from "../../src/core/readings/startup-check.js";
import { zoneAuthorityCheck } from "../../src/core/readings/zone-authority-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

import { ratchetFindings, startupCheckRoots } from "../../src/core/readings/ratchet.js";
const startup = "src/start.ts";
const vendor = "declare module 'unregistered' { export function wire(): void; }\n";

// The findings an entrypoint can raise: which exceptions are entrypoints, what code acquires through its
// accesses, globals and imports, its import edges, and the authority each file holds where it is.
function entrypointFindings(snapshot: Snapshot) {
  const { startups, findings } = startupCheck(snapshot);
  const context = capabilityContext(snapshot, startups);
  const parts = [accessAuthority, globalAuthority, importAuthority].map((part) => part(snapshot, context));
  const edges = edgeCheck(snapshot, context);
  return [
    ...findings,
    ...parts.flatMap((part) => part.findings),
    ...edges.findings,
    ...zoneAuthorityCheck(snapshot, context, authorityGraph(snapshot, context, parts, edges.crossZoneFailures)),
  ];
}

function inspect(
  files: Readonly<Record<string, string>>,
  exceptions = [startup],
  config: Partial<KitConfig> = {},
) {
  const snapshot = sourceFixture(files, { ...config, exceptions });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  const findings = entrypointFindings(snapshot);
  const placed = snapshot.files
    .filter(
      (file) => file.type === "source" && placementOf(file.path, snapshot.config.srcRoot).placed,
    )
    .map((file) => file.path);
  const imports = snapshot.compiler?.projects.flatMap((project) =>
    project.imports
      .filter((edge) => !edge.typeOnly && edge.target !== null)
      .map((edge) => ({ from: edge.file, to: edge.target })),
  );
  const required = startupCheckRoots(snapshot.config);
  return {
    findings,
    placed,
    required,
    failures: ratchetFindings(
      findings,
      findings.map((finding) => finding.debtKey),
      placed,
      imports ?? [],
      required,
    ),
  };
}

const boundaries: readonly {
  readonly cause: string;
  readonly source: string;
  readonly extra: Readonly<Record<string, string>>;
}[] = [
  {
    cause: "native-authority",
    source: "const signal: AbortSignal = new AbortController().signal; void signal;\n",
    extra: {},
  },
  {
    cause: "external-boundary",
    source: "import { wire } from 'unregistered'; wire();\n",
    extra: { "src/vendor.d.ts": vendor },
  },
  {
    cause: "migration-zone",
    source: "import { read } from './legacy.js'; read();\n",
    extra: { "src/legacy.ts": "export function read(): string { return 'legacy'; }\n" },
  },
];

test.each(boundaries)(
  "a startup-only $cause limit fails the actual ratchet",
  ({ cause, source, extra }) => {
    const result = inspect({ [startup]: source, ...extra });
    expect(result.placed).toEqual([]);
    expect(result.required).toEqual([startup]);
    const limit = result.findings.find(
      (finding) => finding.path === startup && finding.debtKey.startsWith(`R1:${cause}:`),
    );
    expect(limit).toEqual(
      expect.objectContaining({ category: "checker-limit", status: "unresolved", blocking: true }),
    );
    expect(result.failures).toContainEqual(limit);
  },
);

test("a malformed source exception cannot leave its own configuration limit outside the ratchet", () => {
  const malformed = "src/*.ts";
  const result = inspect({ [startup]: "void 0;\n" }, [malformed]);
  expect(result.placed).toEqual([]);
  expect(result.required).toEqual([malformed]);
  const limit = result.findings.find(
    (finding) => finding.path === malformed && finding.debtKey.startsWith("R2:startup-placement:"),
  );
  expect(limit).toEqual(
    expect.objectContaining({ category: "checker-limit", status: "unresolved", blocking: true }),
  );
  expect(result.failures).toContainEqual(limit);
});

test("a startup's transitive legacy external boundary remains required", () => {
  const legacy = "src/legacy.ts";
  const result = inspect({
    [startup]: "import { read } from './legacy.js'; read();\n",
    [legacy]: "import { wire } from 'unregistered'; export function read(): void { wire(); }\n",
    "src/vendor.d.ts": vendor,
  });
  const limit = result.findings.find(
    (finding) => finding.path === legacy && finding.debtKey.startsWith("R1:external-boundary:"),
  );
  expect(limit).toEqual(expect.objectContaining({ category: "checker-limit", blocking: true }));
  expect(result.failures).toContainEqual(limit);
});

test("a second-root startup's transitive boundary cannot be waived by baseline debt", () => {
  const entry = "oracle/start.ts";
  const legacy = "oracle/legacy.ts";
  const result = inspect(
    {
      [entry]: "import { read } from './legacy.js'; read();\n",
      [legacy]: "import { wire } from 'unregistered'; export function read(): void { wire(); }\n",
      "oracle/vendor.d.ts": vendor,
    },
    [entry],
    { srcRoot: ["src", "oracle"] },
  );
  expect(result.required).toEqual([entry]);
  const limit = result.findings.find(
    (finding) => finding.path === legacy && finding.debtKey.startsWith("R1:external-boundary:"),
  );
  expect(limit).toEqual(expect.objectContaining({ category: "checker-limit", blocking: true }));
  expect(result.failures).toContainEqual(limit);
});

test.each(["src/start.ts", "oracle/count/increments.test.ts"])(
  "an exact entrypoint's raw clock violation cannot be waived: %s",
  (entry) => {
    const result = inspect({ [entry]: "void Date.now();\n" }, [entry], {
      srcRoot: ["src", "oracle"],
    });
    const violation = result.findings.find(
      (finding) => finding.debtKey === `R1:raw-primitive:${entry}:clock`,
    );
    expect(violation).toEqual(
      expect.objectContaining({ category: "placed-violation", blocking: true }),
    );
    expect(result.failures).toContainEqual(violation);
  },
);

test("an unreachable legacy external boundary stays reported without failing startup", () => {
  const legacy = "src/unreachable.ts";
  const result = inspect({
    [startup]: "void 0;\n",
    [legacy]: "import { wire } from 'unregistered'; export function read(): void { wire(); }\n",
    "src/vendor.d.ts": vendor,
  });
  const limit = result.findings.find(
    (finding) => finding.path === legacy && finding.debtKey.startsWith("R1:external-boundary:"),
  );
  expect(limit).toEqual(expect.objectContaining({ category: "checker-limit", blocking: true }));
  expect(result.required).toEqual([startup]);
  expect(result.failures).toEqual([]);
  expect(result.findings).toContainEqual(limit);
});

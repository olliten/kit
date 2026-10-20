import { expect, test } from "vitest";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { placementOf } from "../../src/core/readings/placement-of.js";
import { sourceFixture } from "../lib/source-fixture.js";

const gateSource =
  process.env.KIT_GATE_SOURCE ?? new URL("../../scripts/kit-check.mjs", import.meta.url).href;
const { ratchetFindings, startupCheckRoots } = await import(gateSource);
const startup = "src/start.ts";
const vendor = "declare module 'unregistered' { export function wire(): void; }\n";

function inspect(
  files: Readonly<Record<string, string>>,
  exceptions = [startup],
  config: Partial<KitConfig> = {},
) {
  const snapshot = sourceFixture(files, { ...config, exceptions });
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  const findings = capabilityCheck(snapshot).findings;
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

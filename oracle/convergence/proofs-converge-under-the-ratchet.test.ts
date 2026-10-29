import { expect, test } from "vitest";
import { capabilityFinding, capabilityLimit } from "../../src/core/readings/capability-context.js";
import { placementOf } from "../../src/core/readings/placement-of.js";
import { ratchetFindings, tightenedBaseline, withProofDebt } from "../../src/core/readings/ratchet.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const proof = "oracle/count/increments.test.ts";
const startup = "src/start.ts";
const wire = "src/legacy/wire.ts";
const shared = "src/legacy/shared.ts";
const placed = "src/core/compositions/count.ts";

// A proof reaching a legacy file of its own and one placed code also reaches, beside a declared startup.
function app() {
  const snapshot = sourceFixture(
    {
      [proof]: "import { wire } from '../../src/legacy/wire.js'; import { share } from '../../src/legacy/shared.js'; wire(); share();\n",
      [wire]: "export function wire(): number { return 1; }\n",
      [shared]: "export function share(): number { return 2; }\n",
      [placed]: "import { share } from '../../legacy/shared.js'; export function count(): number { return share(); }\n",
      [startup]: "void 0;\n",
    },
    { srcRoot: ["src", "oracle"], exceptions: [startup] },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  const placedPaths = snapshot.files
    .filter((file) => file.type === "source" && placementOf(file.path, snapshot.config.srcRoot).placed)
    .map((file) => file.path);
  const imports = (snapshot.compiler?.projects ?? []).flatMap((project) =>
    project.imports.flatMap((edge) =>
      edge.typeOnly || edge.target === null ? [] : [{ from: edge.file, to: edge.target }],
    ),
  );
  const own = capabilityFinding(snapshot, [startup], "R1", "raw-primitive", proof, "Use the clock adapter.", "clock");
  const declared = capabilityFinding(snapshot, [startup], "R1", "raw-primitive", startup, "Use the clock adapter.", "clock");
  const findings = withProofDebt(
    [
      own,
      declared,
      capabilityLimit("external-boundary", wire, "Unclassified.", "unregistered"),
      capabilityLimit("external-boundary", shared, "Unclassified.", "unregistered"),
    ],
    placedPaths,
    imports,
    [startup],
    [proof],
  );
  return { findings, placedPaths, imports };
}

const keyOf = (findings: readonly { readonly debtKey: string; readonly path: string }[], path: string): string =>
  findings.find((finding) => finding.path === path)?.debtKey ?? "";

test("a proof's own violation is its debt, while a declared startup's stays a violation", () => {
  const { findings } = app();
  expect(findings.find((finding) => finding.path === proof)?.category).toBe("proof-debt");
  expect(findings.find((finding) => finding.path === startup)?.category).toBe("placed-violation");
});

test("a limit only a proof reaches is the proof's debt; one placed code also reaches stays a limit", () => {
  const { findings } = app();
  expect(findings.find((finding) => finding.path === wire)?.category).toBe("proof-debt");
  expect(findings.find((finding) => finding.path === shared)?.category).toBe("checker-limit");
});

test("the baseline holds proof debt, a new proof starts exact, and no baseline covers the code a proof proves", () => {
  const { findings, placedPaths, imports } = app();
  const everyKey = findings.map((finding) => finding.debtKey);
  const held = ratchetFindings(findings, everyKey, placedPaths, imports, [startup]);
  expect(held.map((finding) => finding.path).sort()).toEqual([shared, startup].sort());
  const fresh = ratchetFindings(findings, [], placedPaths, imports, [startup]);
  expect(fresh.map((finding) => finding.path).sort()).toEqual([proof, shared, startup, wire].sort());
});

test("tightening keeps unpaid proof debt and drops what was paid", () => {
  const { findings } = app();
  const paid = "R1:raw-primitive:oracle/count/paid.test.ts:clock";
  const baseline = [keyOf(findings, proof), keyOf(findings, wire), paid];
  expect(Object.keys(tightenedBaseline(baseline, findings)).sort()).toEqual(
    [keyOf(findings, proof), keyOf(findings, wire)].sort(),
  );
});

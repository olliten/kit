import { describe, expect, test } from "vitest";
import { accessAuthority } from "../../src/core/readings/access-authority.js";
import { capabilityContext } from "../../src/core/readings/capability-context.js";
import { placementOf } from "../../src/core/readings/placement-of.js";
import { projectSnapshot } from "../core/readings/project-snapshot.js";
import { recordedAuthority } from "../substrate/compositions/recorded-authority.js";

describe("placementOf reads zone and layer from <root>/<zone>/<layer>/<name>", () => {
  test("a placed source file", () => {
    expect(placementOf("src/core/readings/total.ts", "src")).toEqual({
      placed: true,
      zone: "core",
      layer: "readings",
      name: "total",
      rest: "ts",
      artifact: "core/readings/total",
    });
  });

  test("the source extension is separate from the module identity", () => {
    const at = placementOf("src/shell/compositions/paint.tsx", "src");
    expect(at.placed && [at.artifact, at.rest]).toEqual(["shell/compositions/paint", "tsx"]);
  });

  test("a multi-part suffix keeps the name before the first dot", () => {
    const at = placementOf("src/core/readings/total.property.test.ts", "src");
    expect(at.placed && [at.artifact, at.rest]).toEqual([
      "core/readings/total",
      "property.test.ts",
    ]);
  });

  test("an explicit root set gives same-named modules distinct identities", () => {
    const roots = ["src", "oracle"];
    expect(roots.map((root) => placementOf(`${root}/core/readings/value.ts`, roots))).toEqual([
      {
        placed: true,
        zone: "core",
        layer: "readings",
        name: "value",
        rest: "ts",
        artifact: "src/core/readings/value",
      },
      {
        placed: true,
        zone: "core",
        layer: "readings",
        name: "value",
        rest: "ts",
        artifact: "oracle/core/readings/value",
      },
    ]);
    expect(placementOf("src-other/core/readings/value.ts", roots)).toEqual({ placed: false });
    const single = placementOf("src/core/readings/value.ts", ["src"]);
    expect(single.placed && single.artifact).toBe("src/core/readings/value");
  });

  test("root order does not change identity, and mapped directories keep their role", () => {
    const path = "tests/support/substrate/effect/run.ts";
    const a = placementOf(path, ["src", "tests/support"], { compositions: "effect" });
    const b = placementOf(path, ["tests/support", "src"], { compositions: "effect" });
    expect(a).toEqual(b);
    expect(a.placed && [a.layer, a.artifact]).toEqual([
      "compositions",
      "tests/support/substrate/compositions/run",
    ]);
  });

  test.each(
    [
      [],
      ["src", "src"],
      ["src", "src/oracle"],
      ["src/"],
      ["."],
      ["../src"],
      ["/src"],
      ["src\\oracle"],
      ["src/*"],
      ["src//oracle"],
      [" src"],
    ].map((roots) => ({ roots })),
  )("an invalid root set $roots is rejected", ({ roots }) => {
    expect(() => placementOf("src/core/readings/value.ts", roots)).toThrow(/code roots/);
  });

  test.each([
    ["outside the root", "lib/core/primitives/x.ts"],
    ["directly under the root", "src/main.ts"],
    ["one level deep", "src/core/x.ts"],
    ["too deep", "src/core/primitives/sub/x.ts"],
    ["an unknown zone", "src/client/primitives/x.ts"],
    ["an unknown layer", "src/core/widget/x.ts"],
    ["an obsolete state kind", "src/core/state/x.ts"],
    ["an obsolete reading kind", "src/core/reading/x.ts"],
    ["an obsolete data kind", "src/core/data/x.ts"],
    ["an obsolete effect kind", "src/shell/effect/x.ts"],
    ["no name before the dot", "src/core/primitives/.hidden"],
    ["a dot-prefixed source name", "src/core/primitives/.hidden.ts"],
    ["an empty suffix", "src/core/primitives/value."],
    ["an empty final suffix", "src/core/primitives/value.ts."],
  ])("legacy: %s", (_why, path) => {
    expect(placementOf(path, "src")).toEqual({ placed: false });
  });
});

test("placement and authority classify the same source filenames", () => {
  const paths = ["value.ts", "value.extra.ts", ".hidden.ts"].map(
    (name) => `src/core/readings/${name}`,
  );
  // One compiler project over exactly these files; a fixture that doesn't compile throws.
  const snapshot = projectSnapshot(
    recordedAuthority({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          types: [],
          lib: ["ES2022"],
        },
        files: paths,
      }),
      ...Object.fromEntries(
        paths.map((path) => [path, "export function value(): number { return Date.now(); }\n"]),
      ),
    }),
  );
  const findings = accessAuthority(snapshot, capabilityContext(snapshot, [])).findings;
  for (const path of paths) {
    expect(findings).toContainEqual(
      expect.objectContaining({
        debtKey: `R1:raw-primitive:${path}:clock`,
        category: placementOf(path, snapshot.config.srcRoot).placed
          ? "placed-violation"
          : "legacy-debt",
        blocking: true,
      }),
    );
  }
});

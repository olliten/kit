import { describe, expect, test } from "vitest";
import { placementOf } from "../../src/core/readings/placement-of.js";

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
  ])("legacy: %s", (_why, path) => {
    expect(placementOf(path, "src")).toEqual({ placed: false });
  });
});

import { describe, expect, test } from "vitest";
import { kindOf } from "../../../src/core/reading/kind-of.js";

describe("kindOf reads zone and kind from <root>/<zone>/<kind>/<name>", () => {
  test("a placed source file", () => {
    expect(kindOf("src/core/reading/total.ts", "src")).toEqual({
      placed: true,
      zone: "core",
      kind: "reading",
      name: "total",
      rest: "ts",
      artifact: "core/reading/total",
    });
  });

  test("a test file names its artifact by the prefix before the first dot", () => {
    const at = kindOf("oracle/shell/effect/paint.surface.test.ts", "oracle");
    expect(at.placed && [at.artifact, at.rest]).toEqual(["shell/effect/paint", "surface.test.ts"]);
  });

  test.each([
    ["outside the root", "lib/core/data/x.ts"],
    ["directly under the root", "src/main.ts"],
    ["one level deep", "src/core/x.ts"],
    ["too deep", "src/core/data/sub/x.ts"],
    ["an unknown zone", "src/client/data/x.ts"],
    ["an unknown kind", "src/core/widget/x.ts"],
    ["no name before the dot", "src/core/data/.hidden"],
  ])("legacy: %s", (_why, path) => {
    expect(kindOf(path, "src")).toEqual({ placed: false });
  });
});

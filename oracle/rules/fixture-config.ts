import { DEFAULT_CONFIG, type KitConfig } from "../../src/core/primitives/default-config.js";

export const fixtureConfig: KitConfig = {
  ...DEFAULT_CONFIG,
  adapters: [
    {
      module: "substrate/primitives/cell-store",
      export: "writeCell",
      capability: "cell.apply",
      kind: "apply",
      zones: ["substrate"],
      contract: { type: "CellWriter" },
    },
    {
      module: "substrate/primitives/broad-service",
      export: "save",
      capability: "cell.apply",
      kind: "apply",
      zones: ["substrate"],
      contract: { type: "BroadService" },
    },
    {
      module: "core/primitives/write-description",
      export: "writeDescription",
      capability: "cell.produce",
      kind: "produce",
      zones: ["core"],
    },
    {
      module: "substrate/primitives/apply-description",
      export: "applyDescription",
      capability: "cell.apply",
      kind: "apply",
      zones: ["substrate"],
      contract: { type: "DescriptionWriter" },
    },
    {
      module: "substrate/primitives/clock",
      export: "clock",
      capability: "clock.read",
      kind: "external",
      zones: ["substrate"],
      primitives: ["clock"],
    },
  ],
};

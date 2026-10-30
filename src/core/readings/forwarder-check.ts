import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { legacyCodeOf, placementOf, rootOf } from "./placement-of.js";

export interface ForwarderFinding extends Finding {
  readonly category: "placed-violation" | "legacy-debt";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
}

// A module that only re-exports hides the edge its importers really have, and it is the shape both a dodge of
// the dependency rules and an unfinished split take. Placed, it is a violation; legacy, it is debt the baseline
// may hold but never add to. A declaration file describes code it does not hold, and a declared entrypoint,
// such as a package's public index, is a face the app chose, so neither is a forwarder.
export function forwarderCheck(snapshot: Snapshot): ForwarderFinding[] {
  const { srcRoot, exceptions = [] } = snapshot.config;
  return (snapshot.sizes ?? [])
    .flatMap(({ file, forwards }) =>
      forwards === undefined ||
      /\.d\.[cm]?ts$/.test(file) ||
      exceptions.includes(file) ||
      (rootOf(file, srcRoot) === undefined && !legacyCodeOf(file, snapshot.config.layout?.legacy))
        ? []
        : [
            {
              ...finding(
                "R2",
                "forwarder",
                file,
                `Point each importer at the module it uses (${forwards.join(", ")}) and delete this forwarder.`,
              ),
              category: placementOf(file, srcRoot).placed ? ("placed-violation" as const) : ("legacy-debt" as const),
              status: "violation" as const,
              blocking: true as const,
              limit: "" as const,
            },
          ],
    )
    .sort(byDebtKey);
}

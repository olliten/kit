import type { Snapshot } from "../primitives/snapshot.js";
import { byDebtKey, finding, type Finding } from "./finding.js";
import { legacyCodeOf, rootOf } from "./placement-of.js";

export interface LayoutFinding extends Finding {
  readonly category: "legacy-debt" | "placed-violation";
  readonly status: "violation";
  readonly blocking: true;
  readonly limit: "";
}

export function layoutCheck(snapshot: Snapshot): LayoutFinding[] {
  const { layout, srcRoot, oracleRoot, specRoot } = snapshot.config;
  if (layout === undefined) return [];
  const roots = typeof srcRoot === "string" ? [srcRoot] : srcRoot;
  rootOf("", [...roots, specRoot]);
  if (!roots.includes(oracleRoot))
    throw new Error("Directory roles require the proof root among the governed code roots.");
  legacyCodeOf("", layout.legacy);
  for (const location of layout.legacy)
    if (!snapshot.files.some(({ path }) => legacyCodeOf(path, [location])))
      throw new Error(`Legacy location ${location} matches no existing file; remove its declaration.`);
  const findings: LayoutFinding[] = [];
  for (const { path, type } of snapshot.files) {
    const code = rootOf(path, srcRoot) !== undefined;
    const proof = path.startsWith(`${oracleRoot}/`);
    const spec = path.startsWith(`${specRoot}/`);
    const misplaced = type === "test" ? !proof
      : type === "source" ? !code
      : path.endsWith(".md") ? code && !spec
      : false;
    if (!misplaced) continue;
    const legacy = legacyCodeOf(path, layout.legacy);
    findings.push({
      ...finding("R1", "file-role", path,
        type === "test" ? `Move this proof to ${oracleRoot}/ and preserve its claim binding.`
          : path.endsWith(".md") ? `Move this specification to ${specRoot}/.`
          : "Move implementation or shared proof code into a governed code root.",
      ),
      category: legacy ? "legacy-debt" : "placed-violation",
      status: "violation", blocking: true, limit: "",
    });
  }
  return findings.sort(byDebtKey);
}

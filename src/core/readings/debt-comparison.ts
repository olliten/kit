import type { DebtPolicy } from "../primitives/debt-policy.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { recordedLines } from "./line-ratchet.js";
import { type GateFinding, recordedSize } from "./ratchet.js";

type Entries = Readonly<Record<string, unknown>>;

// A footprint names exact relative paths. It is provided by the caller that knows the change; Kit does
// not silently expand directories, accept globs, or infer a repository comparison.
export function debtPolicyOf(args: readonly string[], footprint: unknown): DebtPolicy {
  const modes = args.flatMap((argument, index) => argument === "--debt-mode"
    ? [args[index + 1]]
    : argument.startsWith("--debt-mode=") ? [argument.slice("--debt-mode=".length)] : []);
  if (modes.length > 1 || modes.some((mode) => mode !== "ratchet" && mode !== "paydown"))
    throw new Error("Supply one --debt-mode, ratchet or paydown.");
  if (!Array.isArray(footprint) || footprint.some((path: unknown) => typeof path !== "string" ||
    path.trim() === "" || path.startsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..") || /[\\*?\[\]]/.test(path)))
    throw new Error("The footprint is a JSON list of exact relative paths.");
  const paths: string[] = footprint;
  if (new Set(paths).size !== paths.length) throw new Error("The footprint repeats a path.");
  const mode = modes[0] === "paydown" ? "paydown" : "ratchet";
  if (mode === "paydown" && paths.length === 0) throw new Error("Paydown requires a nonempty footprint.");
  return { mode, footprint: paths };
}

// The measured ceilings have rule-specific meaning: lines, or total and own statements. Reasons and
// other descriptive metadata are not budgets and do not establish architectural progress.
function weaker(candidate: unknown, reference: unknown): boolean {
  const lines = recordedLines(candidate);
  const approvedLines = recordedLines(reference);
  if (lines !== approvedLines && (lines === undefined || approvedLines === undefined || lines > approvedLines))
    return true;
  const size = recordedSize(candidate);
  const approvedSize = recordedSize(reference);
  if (size === undefined || approvedSize === undefined) return size !== approvedSize;
  return size.statements > approvedSize.statements ||
    size.statements - size.calls > approvedSize.statements - approvedSize.calls;
}

function violation(item: Finding): GateFinding {
  return { ...item, category: "placed-violation", status: "violation", blocking: true, limit: "" };
}

function reductions(
  findings: readonly GateFinding[],
  reference: Entries,
  policy: DebtPolicy,
  waiting: readonly string[],
): string[] {
  const current = new Map(findings.map((item) => [item.debtKey, item]));
  const footprint = new Set(policy.footprint);
  return Object.entries(reference).flatMap(([key, entry]) => {
    if (!footprint.has(key.split(":")[2] ?? "") || waiting.some((prefix) => key.startsWith(prefix))) return [];
    const now = current.get(key);
    if (now === undefined) return [key];
    const lines = recordedLines(entry);
    if (lines !== undefined && now.lines !== undefined && now.lines < lines) return [key];
    const size = recordedSize(entry);
    return size !== undefined && now.statements !== undefined && now.calls !== undefined &&
      now.statements - now.calls < size.statements - size.calls ? [key] : [];
  });
}

// The candidate cannot authorize its own new debt. Paydown is judged against actual findings on the
// supplied footprint, never the candidate's smaller-looking JSON or an unobserved execution obligation.
export function debtPolicyFindings(
  findings: readonly GateFinding[],
  candidate: Entries,
  reference: Entries,
  policy: DebtPolicy,
  waiting: readonly string[] = [],
): GateFinding[] {
  const failures = Object.entries(candidate).flatMap(([key, entry]) => {
    if (Object.hasOwn(reference, key) && !weaker(entry, reference[key])) return [];
    return [violation(finding(
      "R4", "baseline-reference", key.split(":")[2] ?? "kit/debt",
      Object.hasOwn(reference, key)
        ? `The candidate weakens the approved budget for ${key}. Keep or reduce the approved ceiling.`
        : `The approved reference contains no ${key}. Fix the new obligation instead of adding it to the baseline.`,
      encodeURIComponent(key),
    ))];
  });
  if (policy.mode === "paydown" && reductions(findings, reference, policy, waiting).length === 0)
    failures.push(violation(finding(
      "R4", "debt-paydown", "kit/debt",
      "Paydown needs at least one actual approved obligation resolved or budget reduced within its footprint, with complete evidence.",
    )));
  return failures.sort(byDebtKey);
}

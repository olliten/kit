import type { KitConfig } from "../primitives/default-config.js";
import type { Finding } from "./finding.js";
import { lineFailure, recordedLines, tightenedLines } from "./line-ratchet.js";

export interface GateFinding extends Finding {
  readonly category: "legacy-debt" | "proof-debt" | "checker-limit" | "placed-violation" | "pending";
  readonly status: string;
  readonly blocking: boolean;
  readonly limit: string;
  // A legacy module's size: its statements, and those that only call into placed modules.
  readonly statements?: number;
  readonly calls?: number;
  // A legacy function's size: the lines its body spans.
  readonly lines?: number;
  // Why a pending finding is pending, as its row declares.
  readonly reason?: string;
}

// A baseline names each debt key it holds; it is a record, or a plain list of keys in a test.
export type Baseline = Readonly<Record<string, unknown>> | readonly string[];

export type Size = { readonly statements: number; readonly calls: number };

const isKeyList = (baseline: Baseline): baseline is readonly string[] => Array.isArray(baseline);
const recorded = (baseline: Baseline): Readonly<Record<string, unknown>> =>
  isKeyList(baseline) ? Object.fromEntries(baseline.map((key) => [key, null])) : baseline;

export function recordedSize(entry: unknown): Size | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const statements: unknown = Reflect.get(entry, "statements");
  const calls: unknown = Reflect.get(entry, "calls");
  return Number.isInteger(statements) &&
    Number.isInteger(calls) &&
    typeof statements === "number" &&
    typeof calls === "number" &&
    calls >= 0 &&
    calls <= statements
    ? { statements, calls }
    : undefined;
}

// The entrypoints inside a code root or legacy location, whose limits the ratchet holds like placed code's.
export function startupCheckRoots(config: KitConfig): string[] {
  const roots = typeof config.srcRoot === "string" ? [config.srcRoot] : config.srcRoot;
  return (config.exceptions ?? []).filter(
    (path) =>
      roots.some((root) => path.startsWith(`${root}/`)) ||
      (config.layout?.legacy ?? []).some((location) => path === location || path.startsWith(`${location}/`)),
  );
}

// A legacy module may gain statements that only call into placed code, which is how new placed code is wired in
// from where the app starts; its other statements may only shrink. A module the baseline holds no size for is
// new debt.
function sizeFailure(
  item: GateFinding & Size,
  baseline: Readonly<Record<string, unknown>>,
): GateFinding | undefined {
  const base = Object.hasOwn(baseline, item.debtKey) ? recordedSize(baseline[item.debtKey]) : undefined;
  if (base === undefined)
    return {
      ...item,
      fix: `This legacy module has no recorded size, so its ${item.statements} statements are new debt: place it.`,
    };
  if (item.statements - item.calls <= base.statements - base.calls) return undefined;
  return {
    ...item,
    fix:
      `This legacy module has ${item.statements - item.calls} statements of its own; its baseline records ` +
      `${base.statements - base.calls}. Move the new code into a placed module and call it from here.`,
  };
}

type Imports = readonly { readonly from: string; readonly to: string | null }[];

// The files reachable through runtime imports from the given roots, the roots among them.
function reachableFrom(roots: readonly string[], imports: Imports): Set<string> {
  const reachable = new Set(roots);
  const pending = [...reachable];
  const edges = new Map<string, string[]>();
  for (const { from, to } of imports) if (to !== null) edges.set(from, [...(edges.get(from) ?? []), to]);
  for (let next = pending.pop(); next !== undefined; next = pending.pop())
    for (const target of edges.get(next) ?? [])
      if (!reachable.has(target)) {
        reachable.add(target);
        pending.push(target);
      }
  return reachable;
}

// A limit reachable only through claim proofs is the proofs' debt: what placed code or a declared entrypoint
// also reaches stays a limit, so a proof's debt never covers the code it proves.
export function withProofDebt(
  findings: readonly GateFinding[],
  placedPaths: readonly string[],
  imports: Imports,
  requiredRoots: readonly string[],
  proofs: readonly string[],
): GateFinding[] {
  const required = reachableFrom([...placedPaths, ...requiredRoots], imports);
  const proven = reachableFrom(proofs, imports);
  return findings.map((item) =>
    item.category === "checker-limit" && !required.has(item.path) && proven.has(item.path)
      ? { ...item, category: "proof-debt" }
      : item,
  );
}

// What fails: every placed violation, every limit reachable from placed code or an entrypoint, new legacy
// or proof debt, and a legacy module or function grown beyond its baseline. A pending finding never fails.
export function ratchetFindings(
  findings: readonly GateFinding[],
  baseline: Baseline,
  placedPaths: readonly string[],
  imports: Imports,
  requiredRoots: readonly string[] = [],
): GateFinding[] {
  const entries = recorded(baseline);
  const keys = new Set(Object.keys(entries));
  const reachable = reachableFrom([...placedPaths, ...requiredRoots], imports);
  return findings.flatMap((item) => {
    if (item.category === "checker-limit") return reachable.has(item.path) ? [item] : [];
    if (item.category === "pending") return [];
    if (item.category === "placed-violation") return [item];
    const { statements, calls, lines } = item;
    if (statements !== undefined && calls !== undefined)
      return sizeFailure({ ...item, statements, calls }, entries) ?? [];
    if (lines !== undefined) return lineFailure({ ...item, lines }, entries) ?? [];
    return keys.has(item.debtKey) ? [] : [item];
  });
}

// The baseline only shrinks: a key whose legacy or proof debt is paid leaves it, and a legacy module's size entry takes the
// smaller of what it records and what the module holds now, for its statements and for those that are not
// calls into placed code, as a legacy function's entry does for its lines. Nothing is added, so growth is never
// recorded. A key starting with a waiting prefix stays as it is: its rule did not read the tree, so it found
// nothing paid.
export function tightenedBaseline(
  baseline: Baseline,
  findings: readonly GateFinding[],
  waiting: readonly string[] = [],
): Record<string, unknown> {
  const current = new Map(
    findings
      .filter((item) => item.category === "legacy-debt" || item.category === "proof-debt")
      .map((item) => [item.debtKey, item]),
  );
  return Object.fromEntries(
    Object.entries(recorded(baseline)).flatMap(([key, entry]) => {
      const now = current.get(key);
      if (now === undefined) return waiting.some((prefix) => key.startsWith(prefix)) ? [[key, entry]] : [];
      if (now.lines !== undefined) return [[key, tightenedLines(entry, now.lines)]];
      const base = now.statements === undefined ? undefined : recordedSize(entry);
      if (base === undefined || now.statements === undefined || now.calls === undefined) return [[key, entry]];
      const statements = Math.min(base.statements, now.statements);
      const unplaced = Math.min(base.statements - base.calls, now.statements - now.calls);
      const kept = typeof entry === "object" && entry !== null ? entry : {};
      return [[key, { ...kept, statements, calls: statements - unplaced }]];
    }),
  );
}

export interface PaidDebt {
  readonly debtKey: string;
  readonly fix: string;
  readonly reason?: string;
}

const tighten = "Run `kit check --tighten` to drop paid debt.";

// Why an entry is owed, when it says: a `reason` beside the value it records. No entry needs one, since a
// first baseline holds every key an app owes at once.
export function reasonOf(baseline: Readonly<Record<string, unknown>>, key: string): string | undefined {
  if (!Object.hasOwn(baseline, key)) return undefined;
  const entry = baseline[key];
  if (typeof entry !== "object" || entry === null) return undefined;
  const reason: unknown = Reflect.get(entry, "reason");
  return typeof reason === "string" ? reason : undefined;
}

// An entry is paid exactly when tightening would change it: its key left with no legacy or proof debt finding,
// a legacy size larger than the module now is, or a legacy function's lines more than it now spans. A paid entry left in place would let that debt come back
// unnoticed, so it fails until the baseline records what is owed now. The keys of a rule that waits, starting with
// a waiting prefix, are not judged.
export function paidDebt(
  baseline: Readonly<Record<string, unknown>>,
  findings: readonly GateFinding[],
  waiting: readonly string[] = [],
): PaidDebt[] {
  const tightened = tightenedBaseline(baseline, findings, waiting);
  return Object.keys(baseline)
    .sort()
    .flatMap((key) => {
      const reason = reasonOf(baseline, key);
      const owed = reason === undefined ? {} : { reason };
      if (!Object.hasOwn(tightened, key))
        return [{ debtKey: key, fix: `No finding has this debt key any more. ${tighten}`, ...owed }];
      const lines = recordedLines(baseline[key]);
      const linesNow = recordedLines(tightened[key]);
      if (lines !== undefined && linesNow !== undefined && linesNow < lines)
        return [
          {
            debtKey: key,
            fix: `This legacy function has shrunk: its baseline records ${lines} lines, and it now spans ${linesNow}. ${tighten}`,
            ...owed,
          },
        ];
      const before = recordedSize(baseline[key]);
      const after = recordedSize(tightened[key]);
      if (before === undefined || after === undefined) return [];
      if (before.statements === after.statements && before.calls === after.calls) return [];
      return [
        {
          debtKey: key,
          fix:
            `This legacy module has shrunk: its baseline records ${before.statements - before.calls} statements of ` +
            `its own in ${before.statements}, and it now owes ${after.statements - after.calls} in ${after.statements}. ${tighten}`,
          ...owed,
        },
      ];
    });
}

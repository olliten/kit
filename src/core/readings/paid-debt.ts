import { recordedLines } from "./line-ratchet.js";
import { type GateFinding, recordedSize, tightenedBaseline } from "./ratchet.js";

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

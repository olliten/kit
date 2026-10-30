import type { Finding } from "./finding.js";

type Measured = Finding & { readonly lines: number };

function recordedLines(entry: unknown): number | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const lines: unknown = Reflect.get(entry, "lines");
  return typeof lines === "number" && Number.isInteger(lines) && lines > 0 ? lines : undefined;
}

// A legacy function over the limit may shrink but never grow, so its baseline records the lines it spans. One
// the baseline records no lines for is new debt, as a function that grows past what it records is.
export function lineFailure<T extends Measured>(item: T, baseline: Readonly<Record<string, unknown>>): T | undefined {
  const base = Object.hasOwn(baseline, item.debtKey) ? recordedLines(baseline[item.debtKey]) : undefined;
  if (base === undefined) return { ...item, fix: `${item.fix} The baseline records no lines for it, so it is new debt.` };
  if (item.lines <= base) return undefined;
  return { ...item, fix: `${item.fix} Its baseline records ${base}, and a legacy function may only shrink.` };
}

// What the baseline keeps for a legacy function: the fewer of the lines it records and those the function spans
// now, so a function that shrank can't grow back. An entry recording no lines is kept as it is, since adding
// them would record what never passed.
export function tightenedLines(entry: unknown, lines: number): unknown {
  const base = recordedLines(entry);
  if (base === undefined || typeof entry !== "object" || entry === null) return entry;
  return { ...entry, lines: Math.min(base, lines) };
}

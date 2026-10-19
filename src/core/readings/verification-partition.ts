import type { VerificationCheck } from "../primitives/verification.js";

const positive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

export function verificationWeights(
  checks: readonly VerificationCheck[],
): ReadonlyMap<string, number> {
  const medians = new Map<string, number>();
  for (const resource of new Set(checks.map((check) => check.resource))) {
    const values = checks
      .filter((check) => check.resource === resource)
      .map((check) => check.milliseconds)
      .filter(positive)
      .sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    medians.set(
      resource,
      values.length === 0
        ? 1
        : values.length % 2
          ? (values[middle] ?? 1)
          : ((values[middle - 1] ?? 1) + (values[middle] ?? 1)) / 2,
    );
  }
  return new Map(
    checks.map((check) => [
      check.id,
      positive(check.milliseconds)
        ? check.milliseconds
        : (medians.get(check.resource) ?? 1),
    ]),
  );
}

export function verificationPartition(
  checks: readonly VerificationCheck[],
  count: number,
  initialLoads: readonly number[] = [],
): {
  readonly parts: readonly (readonly VerificationCheck[])[];
  readonly loads: readonly number[];
} {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("A partition needs a positive worker count");
  if (new Set(checks.map((check) => check.id)).size !== checks.length)
    throw new Error("Repeated verification identity");
  const weights = verificationWeights(checks);
  const weight = (check: VerificationCheck): number =>
    weights.get(check.id) ?? 1;
  const ordered = [...checks].sort(
    (a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id),
  );
  const parts: VerificationCheck[][] = Array.from({ length: count }, () => []);
  const loads = Array.from({ length: count }, (_, index) =>
    Math.max(0, initialLoads[index] ?? 0),
  );
  if (loads.some((load) => !Number.isFinite(load)))
    throw new Error("Invalid initial worker load");
  for (const check of ordered) {
    let at = 0;
    for (let index = 1; index < count; index++)
      if ((loads[index] ?? 0) < (loads[at] ?? 0)) at = index;
    parts[at]?.push(check);
    loads[at] = (loads[at] ?? 0) + weight(check);
  }
  for (const part of parts) part.sort((a, b) => a.id.localeCompare(b.id));
  return { parts, loads };
}

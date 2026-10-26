export interface CheckFailure {
  readonly rule: string;
  readonly check: string;
  readonly key: string;
  readonly fix: string;
}

export interface CheckOutput {
  readonly counts: Readonly<Record<string, unknown>>;
  readonly failures: readonly CheckFailure[];
  readonly byCheck: Readonly<Record<string, number>>;
}

// The Kit commit an app pins, read from its lockfile's text.
export function pinnedKit(lock: string | null): string | null {
  if (lock === null) return null;
  const parsed: unknown = JSON.parse(lock);
  const packages: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "packages") : undefined;
  const kit: unknown = typeof packages === "object" && packages !== null ? Reflect.get(packages, "node_modules/kit") : undefined;
  const resolved: unknown = typeof kit === "object" && kit !== null ? Reflect.get(kit, "resolved") : undefined;
  return typeof resolved === "string" ? (resolved.match(/#([0-9a-f]{7,40})$/)?.[1] ?? null) : null;
}

// One check's output as its counts and its failures, the failures grouped by check.
export function readCheck(stdout: string, stderr: string): CheckOutput {
  const summary = stdout.split("\n").find((line) => line.startsWith("Kit check "));
  const parsed: unknown = summary === undefined ? undefined : JSON.parse(summary.slice("Kit check ".length));
  const counts: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "counts") : undefined;
  const failures = stderr.split("\n").flatMap((line) => {
    const [, rule, check, rest, fix] = line.match(/^(R\d):([\w-]+):(.+?): (.+)$/) ?? [];
    return rule === undefined || check === undefined || rest === undefined || fix === undefined
      ? []
      : [{ rule, check, key: `${rule}:${check}:${rest}`, fix }];
  });
  const byCheck: Record<string, number> = {};
  for (const failure of failures) byCheck[failure.check] = (byCheck[failure.check] ?? 0) + 1;
  return {
    counts: typeof counts === "object" && counts !== null ? Object.fromEntries(Object.entries(counts)) : {},
    failures,
    byCheck,
  };
}

export function describeConsumer({
  app,
  pinned,
  kit,
  exitCode,
  failures,
  byCheck,
}: {
  readonly app: string;
  readonly pinned: string | null;
  readonly kit: string;
  readonly exitCode: number | null;
  readonly failures: readonly CheckFailure[];
  readonly byCheck: Readonly<Record<string, number>>;
}): string {
  const pin =
    pinned === null
      ? "pins no Kit"
      : pinned.startsWith(kit) || kit.startsWith(pinned)
        ? "pins this Kit"
        : `pins ${pinned.slice(0, 7)}`;
  if (exitCode === 0) return `${app}: passes (${pin}).`;
  const checks = Object.entries(byCheck)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([check, count]) => `${check} ${count}`)
    .join(", ");
  return [`${app}: ${failures.length} failing (${pin}): ${checks}`, ...failures.map(({ key, fix }) => `  ${key}: ${fix}`)].join(
    "\n",
  );
}

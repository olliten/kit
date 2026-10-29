import type { VerificationCheck, VerificationEvidence } from "../../../src/core/primitives/verification.js";
import { runVerification } from "../../../src/substrate/compositions/verification-runner.mjs";

// How one check ends when run: its verdict, or a thrown execution, and whether recording its success fails.
export interface CheckScript {
  readonly verdict?: "pass" | "fail" | "throw";
  readonly record?: "ok" | "throw";
}

// A check that started, with what was running and recorded at that moment.
export interface ScriptedStart {
  readonly id: string;
  readonly running: readonly string[];
  readonly recorded: readonly string[];
}

// One held check let finish once the named checks have started, with what was running and started just before.
export interface ScriptedStep {
  readonly when: readonly string[];
  readonly release: string;
}

export interface ScriptedSnapshot {
  readonly release: string;
  readonly running: readonly string[];
  readonly started: readonly string[];
}

export interface ScriptedRun {
  readonly results: ReadonlyMap<string, { readonly passed: boolean; readonly reused?: boolean; readonly blocked?: boolean }>;
  readonly starts: readonly ScriptedStart[];
  readonly snapshots: readonly ScriptedSnapshot[];
  readonly recorded: readonly string[];
  // Why the run was rejected, when it was; what started before then is still reported.
  readonly error?: string;
}

// A verification run whose effects are scripted as data. Without steps every check finishes as soon as it
// starts; with steps every check is held until its step releases it, so a proof can see what ran together.
export async function scriptedVerification(
  checks: readonly VerificationCheck[],
  options: {
    readonly scripts?: Readonly<Record<string, CheckScript>>;
    readonly steps?: readonly ScriptedStep[];
    readonly capacity?: Readonly<Record<string, number>>;
    readonly evidence?: readonly VerificationEvidence[];
    readonly reuse?: boolean;
  } = {},
): Promise<ScriptedRun> {
  const starts: ScriptedStart[] = [];
  const snapshots: ScriptedSnapshot[] = [];
  const recorded: string[] = [];
  const running = new Set<string>();
  const releases = new Map<string, () => void>();
  let notify = (): void => {};
  const started = (): Promise<void> =>
    new Promise<void>((resolve) => {
      notify = resolve;
    });
  const held = options.steps !== undefined;
  const execution = runVerification(checks, {
    ...(options.capacity === undefined ? {} : { capacity: options.capacity }),
    ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
    ...(options.reuse === undefined ? {} : { reuse: options.reuse }),
    run: async (check: VerificationCheck) => {
      starts.push({ id: check.id, running: [...running].sort(), recorded: [...recorded].sort() });
      running.add(check.id);
      if (held)
        await new Promise<void>((resolve) => {
          releases.set(check.id, resolve);
          notify();
        });
      running.delete(check.id);
      const verdict = options.scripts?.[check.id]?.verdict ?? "pass";
      if (verdict === "throw") throw new Error("execution failed");
      return { passed: verdict === "pass" };
    },
    record: async (check: VerificationCheck) => {
      if (options.scripts?.[check.id]?.record === "throw") throw new Error("record failed");
      recorded.push(check.id);
    },
  });
  for (const step of options.steps ?? []) {
    while (!step.when.every((id) => starts.some((start) => start.id === id)) || !releases.has(step.release))
      await started();
    snapshots.push({ release: step.release, running: [...running].sort(), started: starts.map((start) => start.id).sort() });
    releases.get(step.release)?.();
  }
  try {
    return { results: await execution, starts, snapshots, recorded };
  } catch (error) {
    return { results: new Map(), starts, snapshots, recorded, error: String(error) };
  }
}

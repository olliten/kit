import type { Runs } from "../primitives/runs.js";
import type { Snapshot } from "../primitives/snapshot.js";
import { type Finding, finding } from "./finding.js";
import { placementOf } from "./placement-of.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTexts = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function runsOf(value: unknown): Runs | null {
  if (!isRecord(value)) return null;
  const { digests, tests } = value;
  if (!isRecord(digests) || !Object.values(digests).every((digest) => typeof digest === "string")) return null;
  if (!isRecord(tests)) return null;
  const read: Record<string, Record<string, string[]>> = {};
  for (const [test, modules] of Object.entries(tests)) {
    if (!isRecord(modules)) return null;
    const ran: Record<string, string[]> = {};
    for (const [module, names] of Object.entries(modules)) {
      if (!isTexts(names)) return null;
      ran[module] = names;
    }
    read[test] = ran;
  }
  const recorded: Record<string, string> = {};
  for (const [path, digest] of Object.entries(digests)) if (typeof digest === "string") recorded[path] = digest;
  return { digests: recorded, tests: read };
}

// The record `kit runs` wrote, while it still describes this code: every placed module and test has the
// digest it was recorded with, and the record names no file that is gone. Otherwise it is a finding, and the
// rules that read it wait until `kit runs` is run again.
export function runsRecord(snapshot: Snapshot): { readonly runs: Runs | null; readonly findings: readonly Finding[] } {
  const path = snapshot.config.runs?.record;
  if (path === undefined) return { runs: null, findings: [] };
  const fix = "Run `kit runs` to record which named functions each test runs, and commit the record.";
  if (snapshot.runsText === undefined || snapshot.runsText === null)
    return { runs: null, findings: [finding("R4", "runs-missing", path, fix)] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.runsText);
  } catch {
    parsed = null;
  }
  const runs = runsOf(parsed);
  if (runs === null) return { runs: null, findings: [finding("R4", "runs-unreadable", path, fix)] };
  const { srcRoot, layerNames, oracleRoot } = snapshot.config;
  const covered = snapshot.files.filter(
    (file) =>
      (file.type === "test" && file.path.startsWith(`${oracleRoot}/`)) ||
      (file.type === "source" && placementOf(file.path, srcRoot, layerNames).placed),
  );
  const present = new Set(covered.map((file) => file.path));
  const stale = [
    ...covered.filter((file) => runs.digests[file.path] !== file.digest).map((file) => file.path),
    ...Object.keys(runs.digests).filter((recorded) => !present.has(recorded)),
  ].sort();
  return stale.length === 0
    ? { runs, findings: [] }
    : { runs: null, findings: [finding("R4", "runs-stale", path, fix, stale.join(","))] };
}

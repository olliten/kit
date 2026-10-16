import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isKitMain } from "./kit-load.mjs";

// Each app pins a Kit commit, so a change to the Kit reaches an app only when the app moves its pin. This
// checks the apps against the Kit checked out here before that happens, so the findings a change brings
// become each app's list of work. A failing app does not fail the run: an app may go red and converge.

/** The Kit commit an app pins, read from its lockfile. */
export function pinnedKit(appRoot) {
  const lock = join(appRoot, "package-lock.json");
  if (!existsSync(lock)) return null;
  const resolved = JSON.parse(readFileSync(lock, "utf8")).packages?.["node_modules/kit"]?.resolved;
  return typeof resolved === "string" ? (resolved.match(/#([0-9a-f]{7,40})$/)?.[1] ?? null) : null;
}

/** One check's output as its counts and its failures, the failures grouped by check. */
export function readCheck(stdout, stderr) {
  const summary = stdout.split("\n").find((line) => line.startsWith("Kit check "));
  const counts = summary === undefined ? {} : JSON.parse(summary.slice("Kit check ".length)).counts;
  const failures = stderr
    .split("\n")
    .map((line) => line.match(/^(R\d):([\w-]+):(.+?): (.+)$/))
    .filter((match) => match !== null)
    .map(([, rule, check, rest, fix]) => ({ rule, check, key: `${rule}:${check}:${rest}`, fix }));
  const byCheck = {};
  for (const failure of failures) byCheck[failure.check] = (byCheck[failure.check] ?? 0) + 1;
  return { counts, failures, byCheck };
}

export function describeConsumer({ app, pinned, kit, exitCode, failures, byCheck }) {
  const pin = pinned === null ? "pins no Kit" : pinned.startsWith(kit) || kit.startsWith(pinned) ? `pins this Kit` : `pins ${pinned.slice(0, 7)}`;
  if (exitCode === 0) return `${app}: passes (${pin}).`;
  const checks = Object.entries(byCheck)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([check, count]) => `${check} ${count}`)
    .join(", ");
  return [
    `${app}: ${failures.length} failing (${pin}): ${checks}`,
    ...failures.map(({ key, fix }) => `  ${key}: ${fix}`),
  ].join("\n");
}

async function main() {
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const apps = process.argv.slice(2);
  if (apps.length === 0) throw new Error("Name the app checkouts to check, such as ../tuck ../app.");
  const kit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: engineRoot, encoding: "utf8" }).stdout.trim();
  for (const given of apps) {
    const root = resolve(given);
    const run = spawnSync(
      process.execPath,
      [
        join(engineRoot, "scripts/kit-check.mjs"),
        "--root",
        root,
        "--config",
        join(root, "kit/config.md"),
        "--baseline",
        join(root, "kit/debt/legacy.json"),
      ],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    const read = readCheck(run.stdout, run.stderr);
    if (run.status !== 0 && read.failures.length === 0)
      throw new Error(`The Kit could not check ${given}:\n${run.stderr}`);
    process.stdout.write(
      describeConsumer({ app: basename(root), pinned: pinnedKit(root), kit, exitCode: run.status, ...read }) + "\n",
    );
  }
}

if (isKitMain(import.meta.url)) await main();

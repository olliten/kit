import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dump } from "js-yaml";
import { configuredKit, kitConfig } from "./kit-config.mjs";
import { isKitMain, withKit } from "./kit-load.mjs";

/** The same declaration with its hosts written out and the keys they replace removed. The hosts are the ones
 * the check already reads, so no finding changes but the deprecation notes.
 * @param {Record<string, unknown>} declaration
 * @param {{hosts: readonly {name: string, lib: readonly string[], zone: string | null, entries: readonly string[], roots: readonly string[], provides: readonly {name: string, exports: readonly string[]}[], enteredBy: readonly {name: string, type: string}[]}[]}} model
 */
export function migratedConfig(declaration, model) {
  const { exceptions: _exceptions, "legacy-test-roots": _roots, hosts: _hosts, ...rest } = declaration;
  const packages = Array.isArray(rest.packages)
    ? rest.packages.map(({ entrypointExports: _exports, ...row }) => row)
    : undefined;
  const hosts = Object.fromEntries(
    model.hosts.map((host) => [
      host.name,
      {
        lib: [...host.lib],
        ...(host.zone === null ? {} : { zone: host.zone }),
        ...(host.entries.length === 0 ? {} : { entries: [...host.entries] }),
        ...(host.roots.length === 0 ? {} : { roots: [...host.roots] }),
        ...(host.provides.length === 0
          ? {}
          : { provides: Object.fromEntries(host.provides.map((row) => [row.name, [...row.exports]])) }),
        ...(host.enteredBy.length === 0
          ? {}
          : { "entered-by": host.enteredBy.map((reference) => `${reference.name}#${reference.type}`) }),
      },
    ]),
  );
  return { ...rest, ...(packages === undefined ? {} : { packages }), hosts };
}

/** Rewrites the one YAML fence of a Markdown configuration, leaving the prose around it as it was.
 * @param {string} text
 * @param {Parameters<typeof migratedConfig>[1]} model
 */
export function migratedConfigText(text, model) {
  const migrated = migratedConfig(kitConfig(text), model);
  const yaml = dump(migrated, { lineWidth: -1, noRefs: true, flowLevel: 3 }).trimEnd();
  return text.replace(/^```yaml[ \t]*\r?\n[\s\S]*?\r?\n```[ \t]*$/m, () => "```yaml\n" + yaml + "\n```");
}

async function main() {
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const given = process.argv[2];
  if (given === undefined || given.startsWith("--"))
    throw new Error("Supply the Markdown configuration to migrate: kit migrate-config <kit/config.md>.");
  const path = resolve(process.cwd(), given);
  const text = readFileSync(path, "utf8");
  await withKit(engineRoot, async (load) => {
    const { DEFAULT_CONFIG } = await load("src/core/primitives/default-config.ts");
    const { hostOf } = await load("src/core/readings/host-of.ts");
    const model = hostOf(configuredKit(DEFAULT_CONFIG, kitConfig(text)));
    const migrated = migratedConfigText(text, model);
    if (migrated !== text) writeFileSync(path, migrated);
    process.stdout.write(`Kit migrate-config: ${given} declares ${model.hosts.map((host) => host.name).join(", ")}.\n`);
  });
}

if (isKitMain(import.meta.url)) await main();

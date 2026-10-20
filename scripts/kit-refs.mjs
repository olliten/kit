import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { configuredKit, kitConfig } from "./kit-config.mjs";
import { isKitMain, withKit } from "./kit-load.mjs";

// A module's claims are derived from the claims that name it, so they are listed here rather than written
// into the module, where they would go stale and make parallel edits collide.

const markdown = (root, folder) =>
  !existsSync(join(root, folder))
    ? []
    : readdirSync(join(root, folder), { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));

/** The text of the list item whose anchor sits on `line`. */
const claimText = (lines, line) => {
  let start = line - 1;
  while (start > 0 && !/^\s*- /.test(lines[start])) start--;
  return lines
    .slice(start, line)
    .map((text) => text.trim())
    .join(" ")
    .replace(/^- /, "")
    .replace(/\s*·?\s*\{#[\w-]+\}\s*$/, "");
};

export async function kitRefs({ engineRoot, root, configPath, target }) {
  return withKit(engineRoot, async (load) => {
    const { DEFAULT_CONFIG } = await load("src/core/primitives/default-config.ts");
    const config = configuredKit(DEFAULT_CONFIG, kitConfig(readFileSync(configPath, "utf8")));
    const { claimInventory } = await load("src/core/readings/claim-inventory.ts");
    const { claimsKeptBy } = await load("src/core/readings/module-references.ts");
    const { placementOf } = await load("src/core/readings/placement-of.ts");
    const isPath = isAbsolute(target) || target.includes("/") || /\.\w+$/.test(target);
    const path = isAbsolute(target) ? relative(root, target).split(sep).join("/") : target;
    const at = placementOf(path, config.srcRoot);
    if (isPath && !at.placed) return null;
    const module = isPath ? at.artifact : path;
    const name = module.split("/").at(-1) ?? "";
    const texts = new Map();
    const claims = [];
    for (const file of markdown(root, config.specRoot)) {
      if (file === config.termsFile) continue;
      const text = readFileSync(join(root, file), "utf8");
      texts.set(file, text.split("\n"));
      const inventory = claimInventory(text, {
        anchor: config.anchor,
        legacy: config.legacyAreas.includes(file),
        separator: config.claimSeparator,
      });
      claims.push(...inventory.declarations.map((claim) => ({ ...claim, file })));
    }
    const kept = claimsKeptBy({ claims });
    const named = [name, ...config.plurals.filter((s) => name.endsWith(s)).map((s) => name.slice(0, -s.length))];
    const found = named.flatMap((term) => kept.get(term.toLowerCase()) ?? []);
    const rows = found.map(({ file, anchor }) => {
      const topic = file.slice(config.specRoot.length + 1).replace(/\.md$/, "");
      const folder = join(root, config.oracleRoot, topic);
      const tests = existsSync(folder)
        ? readdirSync(folder)
            .filter((test) => test.startsWith(`${anchor}.`) && test.endsWith(".test.ts"))
            .map((test) => `${config.oracleRoot}/${topic}/${test}`)
        : [];
      const claim = claims.find((claim) => claim.file === file && claim.anchor === anchor);
      const line = claim?.line ?? 1;
      return {
        file,
        anchor,
        text: claimText(texts.get(file) ?? [], line),
        tests,
        ...(claim?.implementation === undefined ? {} : { implementation: claim.implementation }),
        ...(claim?.proof === undefined ? {} : { proof: claim.proof }),
      };
    });
    return { module, claims: rows };
  });
}

export function describeRefs({ module, claims }) {
  if (claims.length === 0) return `${module} is named by no claim.`;
  return [
    `${module} keeps ${claims.length === 1 ? "1 claim" : `${claims.length} claims`}:`,
    ...claims.flatMap(({ file, anchor, text, tests, implementation, proof }) => [
      `- ${file}#${anchor}: ${text}`,
      ...(implementation === undefined
        ? []
        : [
            `  Implementation (${implementation.length}): ${implementation.map((term) => `{{${term}}}`).join(", ")}`,
          ]),
      ...(proof === undefined
        ? []
        : [`  Proof (${proof.length}): ${proof.map((term) => `{{${term}}}`).join(", ")}`]),
      ...tests.map((test) => `  ${test}`),
    ]),
  ].join("\n");
}

async function main() {
  const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(`--${name}`);
    return index < 0 ? undefined : args.splice(index, 2)[1];
  };
  const hook = args.includes("--hook");
  if (hook) args.splice(args.indexOf("--hook"), 1);
  const given = option("root");
  const config = option("config");
  if (given !== undefined && config === undefined)
    throw new Error("A different governed root requires its --config path.");
  const root = given === undefined ? engineRoot : resolve(given);
  const configPath = config === undefined ? join(engineRoot, "self-config.md") : resolve(config);
  const target = hook ? JSON.parse(readFileSync(0, "utf8")).tool_input?.file_path : args[0];
  if (!target) throw new Error("Name a module, or a source path, to list the claims it keeps.");
  const refs = await kitRefs({ engineRoot, root, configPath, target });
  if (refs === null) return;
  const text = describeRefs(refs);
  process.stdout.write(
    hook
      ? JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }) + "\n"
      : text + "\n",
  );
}

if (isKitMain(import.meta.url)) await main();

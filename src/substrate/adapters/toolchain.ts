import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

// The identities a stored fact or verdict depends on besides the app: the Kit that read it, the runtime a check
// runs on, and the app's manifest and installed packages as a pass holds them.
export interface Toolchain {
  engine(engineRoot: string): string;
  // The extraction producer's source closure and installed dependencies, independently of checker policy.
  extraction(engineRoot: string): string;
  // Node's version, platform and architecture and the app manifest's loader fields; and the whole lockfile when
  // it has no `packages` map to hold each installed package by.
  runtime(root: string): string;
  // The app manifest's scripts, which a check that runs them is kept under.
  scripts(root: string): string;
  // Resolver metadata without scripts. With a resolved graph, dependency declaration names and categories stay,
  // while the graph holds versions. Explicit reads of manifest data never use this projection.
  manifest(path: string, root?: string): string;
  // The state of an installed package by its path in the lockfile, such as `node_modules/@a/b`: its entry, and every
  // path its name is installed at, since installing it nearer an importer changes what the import finds; or nothing
  // when the app has no lockfile with a `packages` map.
  packages(root: string): ((path: string) => string) | undefined;
  // The Kit a check's processes may load, when it reads the app from outside it, or nothing when its files are the app's.
  kit(engineRoot: string, root: string): string;
}

const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
const sha = (text: Buffer | string): string => createHash("sha256").update(text).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const contentOf = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};
const parsed = (text: string | undefined): unknown => {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

const loaderManifest = (path: string): string => {
  const text = contentOf(path);
  if (text === undefined) return "absent";
  const manifest = parsed(text);
  return isRecord(manifest)
    ? sha(JSON.stringify(["name", "main", "type", "imports", "exports"].map((key) => [key, Object.hasOwn(manifest, key), manifest[key] ?? null])))
    : `file:${sha(text)}`;
};

// The installed dependency closure of the producer, including nearer installs and absent optional packages.
// If a lockfile cannot describe that graph, its whole content remains a runtime dependency instead.
function extractionPackages(root: string, names: ReadonlySet<string>): readonly (readonly [string, string])[] {
  const identity = toolchain.packages(root);
  if (identity === undefined) return [];
  const lock = parsed(contentOf(join(root, "package-lock.json")));
  const packages = isRecord(lock) && isRecord(lock["packages"]) ? lock["packages"] : {};
  const pending = [...names].map((name) => `node_modules/${name}`);
  const found = new Map<string, string>();
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (found.has(path)) continue;
    found.set(path, identity(path));
    const entry = packages[path];
    if (!isRecord(entry)) continue;
    const dependencies = new Set(["dependencies", "optionalDependencies", "peerDependencies"].flatMap((key) => {
      const entries = entry[key];
      return isRecord(entries) ? Object.keys(entries) : [];
    }));
    for (const name of dependencies) {
      let directory = join(root, path);
      let selected = `node_modules/${name}`;
      while (directory.startsWith(root)) {
        const candidate = relative(root, join(directory, "node_modules", name));
        if (basename(directory) !== "node_modules" && isRecord(packages[candidate])) {
          selected = candidate;
          break;
        }
        if (directory === root) break;
        directory = dirname(directory);
      }
      pending.push(selected);
    }
  }
  return [...found].sort(([a], [b]) => a.localeCompare(b));
}

// The source graph is read from syntax, including type imports. An opaque dynamic load or an unresolved local
// source falls back to the whole engine rather than guessing which code can produce a fact.
function extractionIdentity(engineRoot: string): string {
  const pending = ["src/substrate/compositions/read-snapshot.ts", "src/substrate/adapters/source-loader.mjs"];
  const sources = new Map<string, string>();
  const external = new Set<string>();
  let complete = true;
  const include = (specifier: string, file: string): void => {
    if (specifier.startsWith("node:")) return;
    // Aliases and absolute paths need the host resolver; the whole producer remains held until those edges
    // can be attributed, rather than treating them as installed package names.
    if (specifier.startsWith("#") || specifier.startsWith("/")) {
      complete = false;
      return;
    }
    if (!specifier.startsWith(".")) {
      external.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0] ?? specifier);
      return;
    }
    const target = resolve(dirname(file), specifier);
    const found = [target, target.replace(/\.js$/, ".ts"), `${target}.ts`, `${target}.mjs`, join(target, "index.ts")]
      .find((path) => contentOf(path) !== undefined);
    if (found === undefined || !found.startsWith(`${engineRoot}/`)) complete = false;
    else pending.push(relative(engineRoot, found));
  };
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (sources.has(path)) continue;
    const file = join(engineRoot, path);
    const text = contentOf(file);
    if (text === undefined) return toolchain.engine(engineRoot);
    sources.set(path, text);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
        if (ts.isStringLiteralLike(node.moduleSpecifier)) include(node.moduleSpecifier.text, file);
        else complete = false;
      } else if (ts.isExternalModuleReference(node)) {
        if (ts.isStringLiteralLike(node.expression)) include(node.expression.text, file);
        else complete = false;
      } else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const first = node.arguments[0];
        if (first !== undefined && ts.isStringLiteralLike(first)) include(first.text, file);
        else complete = false;
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        include(node.argument.literal.text, file);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (!complete) return toolchain.engine(engineRoot);
  return sha(JSON.stringify([
    "extraction/1", toolchain.runtime(engineRoot), [...sources].sort(([a], [b]) => a.localeCompare(b)), extractionPackages(engineRoot, external),
  ]));
}

export const toolchain: Toolchain = {
  // Node's own loader reads the app's package.json, for its module type, exports and imports, where no recorder
  // sees it; no loader reads its scripts. Installed packages are held by the passes that used them, by their
  // lockfile entries, unless the lockfile can't say what each holds.
  runtime(root) {
    const lockfile = contentOf(join(root, "package-lock.json"));
    return createHash("sha256")
      .update(JSON.stringify([process.version, process.platform, process.arch]))
      .update(JSON.stringify(["package.json", loaderManifest(join(root, "package.json"))]))
      .update(JSON.stringify(["package-lock.json", toolchain.packages(root) === undefined ? (lockfile ?? null) : "packages"]))
      .digest("hex");
  },
  scripts(root) {
    const text = contentOf(join(root, "package.json"));
    const manifest = parsed(text);
    return isRecord(manifest) ? JSON.stringify(manifest["scripts"] ?? null) : `file:${sha(text ?? "")}`;
  },
  manifest(path, root) {
    const text = contentOf(path);
    if (text === undefined) return "absent";
    const manifest = parsed(text);
    if (!isRecord(manifest)) return `file:${sha(text)}`;
    const { scripts: _scripts, ...rest } = manifest;
    if (root !== undefined && toolchain.packages(root) !== undefined)
      for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const entries = rest[key];
        if (isRecord(entries)) rest[key] = Object.fromEntries(Object.entries(entries).map(([name, version]) => [name, typeof version === "string" ? "resolved" : version]));
      }
    return `manifest:${sha(JSON.stringify(rest))}`;
  },
  extraction(engineRoot) {
    return extractionIdentity(engineRoot);
  },
  packages(root) {
    const lock = parsed(contentOf(join(root, "package-lock.json")));
    const packages = isRecord(lock) ? lock["packages"] : undefined;
    if (!isRecord(packages)) return undefined;
    // A package's name is its path after the last `node_modules`.
    const nameOf = (path: string): string => {
      const at = path.lastIndexOf("node_modules/");
      return at < 0 ? path : path.slice(at + "node_modules/".length);
    };
    const entries = new Map<string, readonly unknown[]>();
    const places = new Map<string, string[]>();
    for (const [path, entry] of Object.entries(packages)) {
      if (path === "" || !isRecord(entry)) continue;
      entries.set(path, [entry["version"] ?? null, entry["resolved"] ?? null, entry["integrity"] ?? null, entry["link"] ?? null]);
      places.set(nameOf(path), [...(places.get(nameOf(path)) ?? []), path]);
    }
    return (path) => JSON.stringify([entries.get(path) ?? "absent", [...(places.get(nameOf(path)) ?? [])].sort()]);
  },
  // A Kit outside the app is outside what a check's reads record, so a pass whose processes loaded its code holds
  // this identity of it. A Kit that is the app, or sits in it, among its installed packages or not, is read file by
  // file like the rest.
  kit(engineRoot, root) {
    return engineRoot === root || engineRoot.startsWith(`${root}/`) ? "" : toolchain.engine(engineRoot);
  },
  // A check loading Kit outside the app holds the whole source identity; extraction uses its narrower
  // producer identity above. This is also the conservative fallback for an opaque producer dependency.
  engine(engineRoot) {
    const hash = createHash("sha256");
    const visit = (path: string): void => {
      let entries;
      try {
        entries = readdirSync(path, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries.sort(byName)) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) visit(child);
        else if (entry.isFile()) hash.update(JSON.stringify([relative(engineRoot, child)])).update(readFileSync(child));
      }
    };
    visit(join(engineRoot, "src"));
    visit(join(engineRoot, "scripts"));
    for (const file of ["package.json", "package-lock.json"])
      try {
        hash.update(JSON.stringify([file])).update(readFileSync(join(engineRoot, file)));
      } catch {
        hash.update(JSON.stringify([file, null]));
      }
    return hash.digest("hex");
  },
};

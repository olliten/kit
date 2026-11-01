import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// The identities a stored fact or verdict depends on besides the app: the Kit that read it, the runtime a check
// runs on, and the app's manifest and installed packages as a pass holds them.
export interface Toolchain {
  engine(engineRoot: string): string;
  // Node's version, platform and architecture and the app manifest without its scripts; and the whole lockfile when
  // it has no `packages` map to hold each installed package by.
  runtime(root: string): string;
  // The app manifest's scripts, which a check that runs them is kept under.
  scripts(root: string): string;
  // A package manifest's state without its scripts, or its whole content when it is no JSON object.
  manifest(path: string): string;
  // The state of an installed package by its path in the lockfile, such as `node_modules/@a/b`: its entry, and every
  // path its name is installed at, since installing it nearer an importer changes what the import finds; or nothing
  // when the app has no lockfile with a `packages` map.
  packages(root: string): ((path: string) => string) | undefined;
  // The Kit a check's processes may load, when it reads the app from outside it, or nothing when its files are the app's.
  kit(engineRoot: string, root: string): string;
}

const engines = new Map<string, string>();
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

export const toolchain: Toolchain = {
  // Node's own loader reads the app's package.json, for its module type, exports and imports, where no recorder
  // sees it; no loader reads its scripts. Installed packages are held by the passes that used them, by their
  // lockfile entries, unless the lockfile can't say what each holds.
  runtime(root) {
    const lockfile = contentOf(join(root, "package-lock.json"));
    return createHash("sha256")
      .update(JSON.stringify([process.version, process.platform, process.arch]))
      .update(JSON.stringify(["package.json", toolchain.manifest(join(root, "package.json"))]))
      .update(JSON.stringify(["package-lock.json", toolchain.packages(root) === undefined ? (lockfile ?? null) : "packages"]))
      .digest("hex");
  },
  scripts(root) {
    const text = contentOf(join(root, "package.json"));
    const manifest = parsed(text);
    return isRecord(manifest) ? JSON.stringify(manifest["scripts"] ?? null) : `file:${sha(text ?? "")}`;
  },
  manifest(path) {
    const text = contentOf(path);
    if (text === undefined) return "absent";
    const manifest = parsed(text);
    if (!isRecord(manifest)) return `file:${sha(text)}`;
    const { scripts: _scripts, ...rest } = manifest;
    return `manifest:${sha(JSON.stringify(rest))}`;
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
  // The Kit's own source decides what extraction records, so a change to it reads every fact again.
  engine(engineRoot) {
    const known = engines.get(engineRoot);
    if (known !== undefined) return known;
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
    const value = hash.digest("hex");
    engines.set(engineRoot, value);
    return value;
  },
};

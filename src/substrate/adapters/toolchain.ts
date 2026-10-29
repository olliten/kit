import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// The identities a stored fact or verdict depends on besides the app: the Kit that read it, and the runtime and
// installed packages a check runs on.
export interface Toolchain {
  engine(engineRoot: string): string;
  runtime(root: string): string;
  // The Kit a check runs under, when it reads the app from outside it, or nothing when its files are the app's.
  kit(engineRoot: string, root: string): string;
}

const engines = new Map<string, string>();
const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export const toolchain: Toolchain = {
  // Installed packages are outside what a check's reads record, so the lockfile stands for them; and Node's own
  // loader reads the app's package.json, for its module type, exports and imports, where no recorder sees it.
  runtime(root) {
    const text = (file: string): Buffer | string => {
      try {
        return readFileSync(join(root, file));
      } catch {
        return "";
      }
    };
    return createHash("sha256")
      .update(JSON.stringify([process.version, process.platform, process.arch]))
      .update(text("package-lock.json"))
      .update(JSON.stringify(["package.json"]))
      .update(text("package.json"))
      .digest("hex");
  },
  // A Kit outside the app, or among its installed packages, is outside what a check's reads record, so a pass
  // kept under one Kit is never taken for another's. A Kit that is the app, or sits in it, is read like the rest.
  kit(engineRoot, root) {
    const inside = engineRoot === root || (engineRoot.startsWith(`${root}/`) && !engineRoot.slice(root.length + 1).split("/").includes("node_modules"));
    return inside ? "" : toolchain.engine(engineRoot);
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

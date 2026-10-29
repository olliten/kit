import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// The identities a stored fact depends on besides the app: the Kit that read it.
export interface Toolchain {
  engine(engineRoot: string): string;
}

const engines = new Map<string, string>();
const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export const toolchain: Toolchain = {
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

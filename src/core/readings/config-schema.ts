import { type Declaration, isRecord } from "./config-values.js";

export interface ConfigIssue {
  readonly key: string;
  readonly message: string;
}

// A key's value is checked by the section that reads it (null), or is a mapping with its own keys, or a list whose
// rows each hold those keys.
type Keys = { readonly [key: string]: Section };
type Section = null | { readonly keys: Keys } | { readonly rows: Keys };

const CONFIG_KEYS: Keys = {
  app: null,
  roots: { keys: { src: null, spec: null, oracle: null } },
  terms: null,
  "claim-separator": null,
  "legacy-areas": null,
  "legacy-zones": { rows: { zone: null, root: null, files: null } },
  "legacy-test-roots": null,
  layout: { keys: { legacy: null } },
  exceptions: null,
  "dependency-exclusions": { rows: { from: null, to: null, imports: null, reach: null } },
  ignore: null,
  runs: { keys: { record: null, each: null } },
  adapters: {
    rows: {
      module: null,
      export: null,
      capability: null,
      kind: null,
      zones: null,
      contract: { keys: { type: null } },
      primitives: null,
      globals: null,
      packages: null,
    },
  },
  packages: { rows: { name: null, capabilities: null, entrypointExports: null } },
};

// Every key a declaration holds that Kit doesn't read, named by its full path. An ignored key is a promise the
// app believes Kit keeps, so it is never dropped silently. Value shapes stay with the sections that read them.
export function configIssues(declaration: Declaration): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const visit = (value: Declaration, keys: Keys, path: string): void => {
    for (const [key, inner] of Object.entries(value)) {
      const at = path === "" ? key : `${path}.${key}`;
      const known = keys[key];
      if (known === undefined) {
        issues.push({ key: at, message: `${at} is not a key Kit reads.` });
        continue;
      }
      if (known === null) continue;
      if ("rows" in known) {
        if (Array.isArray(inner))
          inner.forEach((row: unknown, index) => {
            if (isRecord(row)) visit(row, known.rows, `${at}[${index}]`);
          });
      } else if (isRecord(inner)) visit(inner, known.keys, at);
    }
  };
  visit(declaration, CONFIG_KEYS, "");
  return issues.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

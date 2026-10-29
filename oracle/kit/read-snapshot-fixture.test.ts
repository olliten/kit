import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { commentCheck } from "../../src/core/readings/comment-check.js";
import { dependencyCheck } from "../../src/core/readings/dependency-check.js";
import { nameCheck } from "../../src/core/readings/name-check.js";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { readSnapshot } from "../../src/substrate/compositions/read-snapshot.js";
import { bindingFindings } from "../core/readings/binding-findings.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

// The clean tally example's files, keyed by their path inside the app.
function example(from: string, below = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of textFiles.entries(from)) {
    const path = `${below}${entry.name}`;
    if (entry.directory) Object.assign(files, example(join(from, entry.name), `${path}/`));
    else if (entry.file) files[path] = textFiles.read(join(from, entry.name));
  }
  return files;
}

// The violations an example never holds, planted over a copy of it: an edge outward, a cycle, a retired word, a
// citation, a debt marker and a module no claim names.
const SEEDED: Readonly<Record<string, string>> = {
  "spec/tally.md": `# Tally

A counter that adds amounts up to a limit.

## Counting

- The total equals the sum of the supplied amounts. {{tally}}, {{total}} {#total-holds}
- One step adds at most the limit, so the tally never sums past it. {{add}}, {{limits}} · {#one-step-is-capped}
- The average is the total over the count of amounts. {{average}} · {#average-of-amounts}

## Showing

- The screen shows the total as text. {{screen}}, {{label}} · {#screen-shows-the-total}
`,
  "spec/terms.md": `# Terms

The tally's language. Sections only group the lines.

## Counting

- **tally** — the amounts added so far
- **amount** — one number added to the tally
- **add** — put one amount on the tally
- **limits** — the bounds one step must keep
- **max** — the largest value allowed
- **step** — one add
- **empty** — holding no amounts
- **total** — the sum of the amounts. Retired: sums.
- **average** — the total over the count of amounts

## Showing

- **label** — the text for one number
- **screen** — what the user sees
- **save** — write the tally out
`,
  "src/core/compositions/add.ts": `import { MAX_STEP } from "../primitives/limits.js";
import type { Tally } from "../primitives/tally.js";

// Seeded: TODO clamp negative amounts.
export function add(tally: Tally, amount: number): Tally {
  return { amounts: [...tally.amounts, Math.min(amount, MAX_STEP)] };
}
`,
  "src/core/primitives/limits.ts": `// Seeded: a citation of {#one-step-is-capped}.
export const MAX_STEP = 10;
`,
  "src/core/readings/total.ts": `import type { Tally } from "../primitives/tally.js";
import { average } from "./average.js";

export function total(tally: Tally): number {
  return tally.amounts.reduce((sum, n) => sum + n, 0);
}

// Seeded cycle: total ↔ average. Seeded name: \`summary\` is not a defined term.
export function summary(tally: Tally): string {
  return \`\${total(tally)} (mean \${average(tally)})\`;
}
`,
  "src/core/readings/label.ts": `// Seeded: this artifact has no spec heading.
export function label(n: number): string {
  return \`\${n}\`;
}
`,
  "src/shell/readings/screen.ts": `import type { Tally } from "../../core/primitives/tally.js";
import { total } from "../../core/readings/total.js";
// Seeded: the shell imports a substrate composition instead of depending only inward.
import type { save } from "../../substrate/compositions/save.js";

export function screen(tally: Tally, _save?: typeof save): string {
  return \`Total: \${total(tally)}\`;
}
`,
  "src/substrate/compositions/save.ts": `import type { add } from "../../core/compositions/add.js";

export function save(write: (text: string) => void, tally: ReturnType<typeof add>): void {
  write(JSON.stringify(tally));
}
`,
  "src/main.ts": `// Legacy: outside \`<zone>/<kind>/\`, so no rule holds it yet.
import { EMPTY_TALLY } from "./core/primitives/tally.js";
import { screen } from "./shell/readings/screen.js";

export const firstScreen = screen(EMPTY_TALLY);
`,
};

const app = temporaryProjects.open("kit-seeded-tally-");
app.write({ ...example(join(import.meta.dirname, "../../examples/tally")), ...SEEDED });
afterAll(() => app.dispose());
const FIXTURE = app.root;

test("the fixture reads as its files, imports, claims and terms", () => {
  const s = readSnapshot(FIXTURE);
  expect(s.files.filter((f) => f.type === "test").map((f) => f.path)).toEqual([
    "oracle/tally/average-of-amounts.test.ts",
    "oracle/tally/one-step-is-capped.test.ts",
    "oracle/tally/screen-shows-the-total.test.ts",
    "oracle/tally/total-holds.test.ts",
  ]);
  // Each claim records the modules it names.
  expect(s.claims?.map((claim) => [claim.anchor, claim.terms])).toEqual([
    ["total-holds", ["tally", "total"]],
    ["one-step-is-capped", ["add", "limits"]],
    ["average-of-amounts", ["average"]],
    ["screen-shows-the-total", ["screen", "label"]],
  ]);
  // The terms file's section headings are not module headings, and its prose omits its term lines.
  expect(s.terms).toHaveLength(12);
  expect(s.terms).toContainEqual({
    term: "total",
    meaning: "the sum of the amounts.",
    retired: ["sums"],
    line: 14,
  });
  expect(s.prose.find((p) => p.file === "spec/terms.md")?.text).not.toContain("**");
  expect(s.symbols).toContainEqual({ file: "src/core/primitives/limits.ts", name: "MAX_STEP" });
  expect(s.imports).toContainEqual({
    from: "src/shell/readings/screen.ts",
    to: "src/substrate/compositions/save.ts",
  });
  // Each spec file's marked references reach the snapshot, so the reference rules check them.
  expect(s.semanticReferences).toContainEqual({ namespace: "term", name: "total", line: 7, file: "spec/tally.md" });
  // Comments, not strings: a `//` inside a URL is not one.
  expect(s.comments).toContainEqual({
    file: "src/core/primitives/limits.ts",
    line: 1,
    text: "// Seeded: a citation of {#one-step-is-capped}.",
  });
});

// The fixture retains direction, cycle, retirement, citation, debt and unnamed-module findings.
// Its summary export remains valid under the ratified supporting-symbol rule.
test("the fixture yields exactly its seeded findings", () => {
  const s = readSnapshot(FIXTURE);
  const all = [...bindingFindings(s), ...dependencyCheck(s), ...nameCheck(s), ...commentCheck(s)];
  expect(all.map((f) => f.debtKey)).toEqual([
    "R4:unreferenced-module:substrate/compositions/save",
    "R2:cycle:core/readings/average:core/readings/average,core/readings/total",
    "R2:edge:shell/readings/screen:substrate/compositions/save",
    "R3:retired-word:spec/tally.md:sums",
    "R3:comment-citation:core/primitives/limits:{#one-step-is-capped}",
    "R3:comment-debt:core/compositions/add:TODO",
  ]);
});

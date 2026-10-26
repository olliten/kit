import { join } from "node:path";
import { expect, test } from "vitest";
import { moduleClaims } from "../../src/substrate/compositions/refs-run.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

test("refs finds a module's claims and tests across code roots and a renamed proof root", async () => {
  const project = temporaryProjects.open("kit-refs-roots-");
  try {
    project.write({
      "src/core/readings/actual.ts": "export function actual(n: number): number { return n + 1; }\n",
      "oracle/core/readings/reference.ts": "export function reference(n: number): number { return n + 1; }\n",
      "spec/terms.md":
        "# Terms\n\n- **actual** — the implementation.\n  - Role: derived\n  - Zone: core\n  - From: []\n- **reference** — the independent expectation.\n  - Role: derived\n  - Zone: core\n  - From: []\n",
      "spec/count.md":
        "# Count\n\nCounting.\n\n## Increment\n\n- The implementation agrees with the reference ({{actual}}, {{reference}}). · {#increments}\n",
      "proof/count/increments.test.ts":
        "import { actual } from '../../src/core/readings/actual.js';\nimport { reference } from '../../oracle/core/readings/reference.js';\nif (actual(1) !== reference(1)) throw new Error('Mismatch');\n",
      "kit/config.md":
        "```yaml\napp: numbers\nroots:\n  src: [src/, oracle/, proof/]\n  spec: spec/\n  oracle: proof/\nterms: spec/terms.md\nexceptions: [proof/count/increments.test.ts]\n```\n",
    });
    const refs = await moduleClaims(project.root, join(project.root, "kit/config.md"), "oracle/core/readings/reference.ts");
    expect(refs?.module).toBe("oracle/core/readings/reference");
    expect(refs?.claims.map((row) => row.tests)).toEqual([["proof/count/increments.test.ts"]]);
  } finally {
    project.dispose();
  }
});

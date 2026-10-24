import { expect, test } from "vitest";
import type { KitConfig } from "../../src/core/primitives/default-config.js";
import { capabilityCheck } from "../../src/core/readings/capability-check.js";
import { sourceFixture } from "../substrate/compositions/source-fixture.js";

const helper = "oracle/substrate/compositions/seed.ts";
const driver =
  "export type PageFunction<Arg, R> = string | ((arg: Arg) => R | Promise<R>);\n" +
  "export interface Page { evaluate<R, Arg>(run: PageFunction<Arg, R>, arg?: Arg): Promise<R>; }\n";
const hosts: NonNullable<KitConfig["hosts"]> = {
  server: { lib: ["node"], zone: "substrate" },
  proof: { lib: ["node"] },
  page: { lib: ["dom"], enteredBy: ["browser-driver#PageFunction"] },
};

function inspect(body: string, config: Partial<KitConfig> = { hosts }) {
  const snapshot = sourceFixture(
    {
      "node_modules/browser-driver/index.d.ts": driver,
      [helper]: `import type { Page } from 'browser-driver';\n${body}`,
    },
    { srcRoot: ["oracle", "src"], ...config },
  );
  expect(snapshot.compiler?.projects.flatMap((project) => project.diagnostics)).toEqual([]);
  return { snapshot, findings: capabilityCheck(snapshot).findings };
}

const seed = "export function seed(page: Page): Promise<string | null> {\n  return page.evaluate(() => localStorage.getItem('k'));\n}\n";

test("a page function literal runs in the page host and charges nothing to its proof helper", () => {
  const { snapshot, findings } = inspect(seed);
  expect(snapshot.compiler?.projects.flatMap((project) => project.programs ?? [])).toEqual([
    expect.objectContaining({ file: helper, host: "page", type: "browser-driver#PageFunction", literal: true, captures: [] }),
  ]);
  expect(findings).toEqual([]);
});

test("without the entry type the same literal is the helper's own Window authority", () => {
  const { findings } = inspect(seed, {
    hosts: { server: { lib: ["node"], zone: "substrate" }, proof: { lib: ["node"] } },
  });
  expect(findings).toContainEqual(
    expect.objectContaining({ debtKey: `R1:window-authority:${helper}` }),
  );
});

test("raw clock reads inside the literal belong to the page, not the helper", () => {
  expect(
    inspect("export function stamp(page: Page): Promise<number> { return page.evaluate(() => Date.now()); }\n").findings,
  ).toEqual([]);
});

test("a literal that captures an outer name is a finding, since the page runs a serialized copy", () => {
  const { findings } = inspect(
    "const key = 'k';\nexport function seed(page: Page): Promise<string | null> {\n" +
      "  return page.evaluate(() => localStorage.getItem(key));\n}\n",
  );
  expect(findings).toEqual([
    expect.objectContaining({ debtKey: `R1:entry-capture:${helper}:key`, category: "placed-violation", blocking: true }),
  ]);
});

test("the literal's own parameters and locals are not captures", () => {
  expect(
    inspect(
      "export function seed(page: Page): Promise<string | null> {\n" +
        "  return page.evaluate((key: string) => { const found = localStorage.getItem(key); return found; }, 'k');\n}\n",
    ).findings,
  ).toEqual([]);
});

test.each([
  ["a function reference", "const read = (): string | null => localStorage.getItem('k');\nexport function seed(page: Page): Promise<string | null> { return page.evaluate(read); }\n"],
  ["a source string", "export function seed(page: Page): Promise<unknown> { return page.evaluate('localStorage.getItem(1)'); }\n"],
])("%s of an entry type stays a limit", (_, body) => {
  expect(inspect(body).findings).toContainEqual(
    expect.objectContaining({
      debtKey: expect.stringMatching(new RegExp(`^R1:entry-program:${helper}:browser-driver#PageFunction:\\d+$`)),
      category: "checker-limit",
      blocking: true,
    }),
  );
});

test("a global the page host's libraries do not declare is a finding inside the literal", () => {
  const { findings } = inspect(seed, {
    hosts: { ...hosts, page: { lib: ["webworker"], enteredBy: ["browser-driver#PageFunction"] } },
  });
  expect(findings).toContainEqual(
    expect.objectContaining({ debtKey: `R1:host-global:${helper}:localStorage` }),
  );
});

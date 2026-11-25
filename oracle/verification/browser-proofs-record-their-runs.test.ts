import { createHash } from "node:crypto";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { browserCapture } from "../../src/substrate/adapters/browser-capture.js";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { recordBrowserProof } from "../../src/substrate/compositions/browser-proof.js";
import { temporaryProjects, type TemporaryProject } from "../substrate/adapters/temporary-project.js";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

const PROOF = "oracle/topic/idle-search.browser.test.ts";
const SOURCE = "src/shell/readings/idle.js";
const TEXT = [
  "function searched(query) { return query.trim(); }",
  "function unused() { return 0; }",
  "window.result = searched(' idle ');",
  "",
].join("\n");
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(value: number): string {
  let unsigned = Math.abs(value) * 2 + (value < 0 ? 1 : 0);
  let text = "";
  do {
    const part = unsigned % 32;
    unsigned = Math.floor(unsigned / 32);
    text += ALPHABET[part + (unsigned > 0 ? 32 : 0)];
  } while (unsigned > 0);
  return text;
}

// The script served as its own source: a segment at every word, each mapping to the same place.
function identityMap(text: string, source: string): string {
  let previousLine = 0;
  let previousSource = 0;
  const mappings = text.split("\n").map((line, index) => {
    let previousColumn = 0;
    const segments = [...line.matchAll(/\b\w/g)].map((match) => {
      const column = match.index ?? 0;
      const segment = `${vlq(column - previousColumn)}A${vlq(index - previousLine)}${vlq(column - previousSource)}`;
      previousColumn = column;
      previousSource = column;
      previousLine = index;
      return segment;
    });
    return segments.join(",");
  });
  return JSON.stringify({ version: 3, sources: [source], names: [], mappings: mappings.join(";") });
}

const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

function app(project: TemporaryProject, scripts = [{ scriptHash: digest(TEXT), base: "", map: "public/app.js.map" }]): void {
  project.write({
    [SOURCE]: TEXT,
    "public/app.js.map": identityMap(TEXT, SOURCE),
    "public/kit-map.json": JSON.stringify({ version: 1, scripts }),
    "functions.json": JSON.stringify({
      version: 1,
      functions: [
        { file: SOURCE, name: "searched", line: 1, start: 0, end: TEXT.indexOf("\n") },
        { file: SOURCE, name: "unused", line: 2, start: TEXT.indexOf("function unused"), end: TEXT.indexOf("\nwindow") },
      ],
    }),
  });
}

async function serve(context: BrowserContext, body: string, extra = ""): Promise<void> {
  await context.route("http://app.test/**", (route) =>
    route.fulfill(route.request().url().endsWith("/app.js")
      ? { contentType: "text/javascript", body }
      : { contentType: "text/html", body: `<html><body><script src="/app.js"></script>${extra}</body></html>` }),
  );
}

async function proved(project: TemporaryProject, drive: (context: BrowserContext) => Promise<void>) {
  const context = await browser.newContext();
  const proof = recordBrowserProof(await browserCapture.start(context), { maps: "public/kit-map.json" }, {
    coverage: `${project.root}/runs`, test: PROOF, runtime: "node-runtime", root: project.root, functions: `${project.root}/functions.json`,
  });
  await drive(context);
  await proof.done();
  await context.close();
  const directory = `${project.root}/runs/${encodeURIComponent(PROOF)}`;
  return {
    context: JSON.parse(textFiles.read(`${directory}/browser-context.json`)),
    lcov: textFiles.exists(`${directory}/browser.info`) ? textFiles.read(`${directory}/browser.info`) : "",
  };
}

const opened = (body = TEXT, extra = "") => async (context: BrowserContext): Promise<void> => {
  await serve(context, body, extra);
  const page = await context.newPage();
  await page.goto("http://app.test/");
  await page.evaluate(() => 1 + 1);
};

test("outside kit verify a browser proof writes nothing", async () => {
  const project = temporaryProjects.open("kit-browser-proof-");
  try {
    const context = await browser.newContext();
    const proof = recordBrowserProof(await browserCapture.start(context), { maps: `${project.root}/map.json` }, { coverage: undefined, test: undefined, runtime: undefined });
    await proof.done();
    await context.close();
    expect(textFiles.entries(project.root)).toEqual([]);
  } finally {
    project.dispose();
  }
});

test("a page's functions are written as the proof's runs, with the original sources it loaded", async () => {
  const project = temporaryProjects.open("kit-browser-proof-");
  try {
    app(project);
    const { context, lcov } = await proved(project, opened());
    expect(context).toEqual({ complete: true, loaded: [SOURCE], runtime: "node-runtime" });
    expect(lcov).toContain(`SF:${SOURCE}\n`);
    expect(lcov).toMatch(/FNDA:[1-9]\d*,searched\n/);
    expect(lcov).toContain("FNDA:0,unused\n");
  } finally {
    project.dispose();
  }
});

test("a capture it cannot complete is written incomplete under the test's own directory, never left out", async () => {
  const project = temporaryProjects.open("kit-browser-proof-");
  try {
    app(project);
    // A script no map names, a worker, and a missing map artifact each leave the capture incomplete.
    for (const drive of [
      opened(`${TEXT}// rebuilt\n`),
      opened(TEXT, `<script>new Worker(URL.createObjectURL(new Blob(["1"])))</script>`),
    ]) expect((await proved(project, drive)).context).toMatchObject({ complete: false });
    project.remove("public/kit-map.json");
    expect((await proved(project, opened())).context).toMatchObject({ complete: false, runtime: "node-runtime" });
  } finally {
    project.dispose();
  }
});

test("a script the map declares external is not the app's and leaves the capture complete", async () => {
  const project = temporaryProjects.open("kit-browser-proof-");
  try {
    app(project);
    project.write({ "public/kit-map.json": JSON.stringify({ version: 1, scripts: [{ scriptHash: digest(TEXT), base: "", map: "public/app.js.map" }], external: ["http://app.test/vendor"] }) });
    const drive = async (context: BrowserContext): Promise<void> => {
      await context.route("http://app.test/vendor.js", (route) => route.fulfill({ contentType: "text/javascript", body: "window.v = 1;" }));
      await opened(TEXT, `<script src="/vendor.js"></script>`)(context);
    };
    expect((await proved(project, drive)).context).toEqual({ complete: true, loaded: [SOURCE], runtime: "node-runtime" });
  } finally {
    project.dispose();
  }
});

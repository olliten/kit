import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, expect, test } from "vitest";
import { browserCapture } from "../../src/substrate/adapters/browser-capture.js";
import { recordBrowserProof } from "../../src/substrate/compositions/browser-proof.js";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

const test_ = "oracle/topic/idle-search.browser.test.ts";

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

test("a capture it cannot complete is written incomplete under the test's own directory, never left out", async () => {
  const project = temporaryProjects.open("kit-browser-proof-");
  try {
    const context = await browser.newContext();
    const proof = recordBrowserProof(await browserCapture.start(context), { maps: `${project.root}/missing.json` }, { coverage: `${project.root}/runs`, test: test_, runtime: "node-runtime" });
    const page = await context.newPage();
    await page.setContent("<script>function idle() { return 1 } idle()</script>");
    await proof.done();
    await context.close();
    const written = JSON.parse(textFiles.read(`${project.root}/runs/${encodeURIComponent(test_)}/browser-context.json`));
    expect(written).toMatchObject({ complete: false, runtime: "node-runtime" });
  } finally {
    project.dispose();
  }
});

import { join } from "node:path";
import { expect, test } from "vitest";
import { textFiles } from "../../src/substrate/adapters/text-files.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";
import { authoredExample } from "../substrate/compositions/authored-example.js";


test("example copies read authored roots, never the example's runtime-output inventory", () => {
  const project = temporaryProjects.open("kit-authored-example-");
  const entries = textFiles.entries;
  const read = textFiles.read;
  try {
    const authored = {
      "package.json": '{"name":"example"}', "tsconfig.json": '{"include":["src"]}',
      "src/read.ts": "export const value = 1;", "spec/topic.md": "# Topic",
      "oracle/topic/proves.test.ts": "export const proof = true;", "kit/config.md": "# Config",
    };
    project.write({ ...authored, "unrelated-output/first.txt": "runtime" });
    const listing: string[] = [];
    const reading: string[] = [];
    textFiles.entries = (path) => {
      listing.push(path);
      expect(path).not.toBe(project.root);
      return entries(path);
    };
    textFiles.read = (path) => { reading.push(path); return read(path); };
    expect(authoredExample(project.root)).toEqual(authored);
    expect(new Set(reading))
      .toEqual(new Set(Object.keys(authored).map((path) => join(project.root, path))));
    expect(new Set(listing)).toEqual(new Set([
      "src", "spec", "oracle", "oracle/topic", "kit",
    ].map((path) => join(project.root, path))));

    project.write({ "unrelated-output/second.txt": "later runtime", "another-output/value.txt": "new" });
    reading.length = 0;
    expect(authoredExample(project.root)).toEqual(authored);
    expect(new Set(reading))
      .toEqual(new Set(Object.keys(authored).map((path) => join(project.root, path))));

    project.write({ "src/nested/new.ts": "export const added = 2;" });
    expect(authoredExample(project.root)).toEqual({ ...authored, "src/nested/new.ts": "export const added = 2;" });
  } finally { textFiles.entries = entries; textFiles.read = read; project.dispose(); }
});

test("seeded replacement bodies are supplied without reading their original native input", () => {
  const project = temporaryProjects.open("kit-seeded-example-");
  const read = textFiles.read;
  try {
    project.write({
      "package.json": "{}", "tsconfig.json": "{}", "src/read.ts": "original",
      "spec/topic.md": "# Topic", "oracle/proves.test.ts": "proof", "kit/config.md": "# Config",
    });
    const reading: string[] = [];
    textFiles.read = (path) => {
      reading.push(path);
      if (path === join(project.root, "src/read.ts")) throw new Error("An overridden body is not an input.");
      return read(path);
    };
    const overrides = { "src/read.ts": "replacement", "src/new.ts": "added" };
    const result = authoredExample(project.root, overrides);
    expect(result["src/read.ts"]).toBe("replacement");
    expect(result["src/new.ts"]).toBe("added");
    expect(overrides).toEqual({ "src/read.ts": "replacement", "src/new.ts": "added" });
    expect(reading).not.toContain(join(project.root, "src/read.ts"));
    project.remove("package.json");
    expect(() => authoredExample(project.root, overrides)).toThrow();
  } finally { textFiles.read = read; project.dispose(); }
});

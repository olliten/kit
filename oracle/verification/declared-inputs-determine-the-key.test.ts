import { expect, test } from "vitest";
import type { FileMap, InputDecl, InputDeclaration, KeyContext } from "../../src/core/primitives/declared-input.js";
import { declaredInputFiles } from "../../src/substrate/adapters/declared-input-files.js";
import { temporaryProjects } from "../substrate/adapters/temporary-project.js";

const context: KeyContext = { format: "leeloo-analysis-key/1", runtime: "v24.19.0" };
const key = (name: string, inputs: FileMap, code: FileMap, mode = context) =>
  declaredInputFiles.inputKey(name, inputs, code, mode);

// Captured from Leeloo's unchanged analysisKey/analysisKeyOf on Node v24.19.0 before extraction.
test("legacy golden streams retain exact framing, binary bytes and UTF-16 names", () => {
  expect(key("empty", new Map(), new Map())).toBe("d9a84cf615a4ea5b0b73c38ff71eb56761f624e37122e2e88eabe24ce02017ea");
  expect(key("binary", new Map([["data.bin", new Uint8Array([0, 255, 128, 10])]]), new Map([["engine.ts", "return 7;"]]))).toBe("26863030212a1e422dec500cf0d8716d5cff6caf624921508d70002bc071f155");
  expect(key("a\u0000b", new Map([["x\ud800", "é\u0000"]]), new Map([["x\ud800", new Uint8Array([0, 1, 2])]]))).toBe("7f1984265f5fef3b75dd0c2f58292cb152774a9c238a9c25e8648816ed23f324");
});

test("map insertion order is irrelevant while names, paths, domains and context remain distinct", () => {
  const inputs = new Map([["a", "one"], ["b", "two"]]);
  const code = new Map([["c", "three"], ["d", "four"]]);
  const before = key("proof", inputs, code);
  expect(key("proof", new Map([...inputs].reverse()), new Map([...code].reverse()))).toBe(before);
  const changes = [
    key("other", inputs, code),
    key("proof", new Map([["renamed", "one"], ["b", "two"]]), code),
    key("proof", new Map([["a", "one!"], ["b", "two"]]), code),
    key("proof", inputs, new Map([["c", "three!"], ["d", "four"]])),
    key("proof", code, inputs),
    key("proof", inputs, code, { ...context, format: "other/1" }),
    key("proof", inputs, code, { ...context, runtime: "another-runtime" }),
  ];
  for (const changed of changes) expect(changed).not.toBe(before);
  expect(new Set(changes).size).toBe(changes.length);
  expect(key("ab", new Map([["c", "d"]]), new Map())).not.toBe(key("a", new Map([["bc", "d"]]), new Map()));
  expect(key("proof", new Map([["a", "bc"]]), new Map())).not.toBe(key("proof", new Map([["ab", "c"]]), new Map()));
});

test("each byte contributes without UTF-8 replacement loss", () => {
  const inputs = new Map([["binary", new Uint8Array([0, 255, 128, 10])]]);
  const before = key("proof", inputs, new Map());
  for (let index = 0; index < 4; index++) {
    const changed = new Uint8Array([0, 255, 128, 10]);
    changed[index] = changed[index]! ^ 1;
    expect(key("proof", new Map([["binary", changed]]), new Map())).not.toBe(before);
  }
  expect(key("proof", new Map([["binary", new Uint8Array([255])]]), new Map())).not.toBe(key("proof", new Map([["binary", new Uint8Array([254])]]), new Map()));
  expect(key("proof", new Map([["text", "é"]]), new Map())).toBe(key("proof", new Map([["text", new Uint8Array([195, 169])]]), new Map()));
});

test("resolution deduplicates and sorts matching tree files and keys additions, renames and deletions", () => {
  const project = temporaryProjects.open("kit-input-trees-");
  try {
    project.write({ "data/b.txt": "b", "data/nested/a.txt": "a", "data/no.json": "ignored", "engine.ts": "code" });
    const inputs: InputDecl[] = [{ tree: "data", suffix: ".txt" }, { file: "data/b.txt" }];
    const declaration = { name: "proof", inputs, code: [{ file: "engine.ts" }] };
    const current = () => declaredInputFiles.inputKeyOf(declaration, project.root, context);
    expect(declaredInputFiles.resolveInputs(project.root, inputs)).toEqual(["data/b.txt", "data/nested/a.txt"]);
    let before = current();
    project.write({ "data/no.json": "changed but still irrelevant" });
    expect(current()).toBe(before);
    for (const action of [
      () => project.write({ "data/c.txt": "c" }),
      () => { project.remove("data/c.txt"); project.write({ "data/renamed.txt": "c" }); },
      () => project.remove("data/b.txt"),
      () => project.write({ "engine.ts": "different checker" }),
    ]) {
      action();
      const after = current();
      expect(after).not.toBe(before);
      before = after;
    }
  } finally { project.dispose(); }
});

test("file, directory and presence states preserve the legacy golden stream", () => {
  const project = temporaryProjects.open("kit-input-states-");
  try {
    project.directory("directory");
    project.write({ present: "ignored bytes", "file.bin": new Uint8Array([0, 255, 128, 10]) });
    const declaration: InputDeclaration = {
      name: "states",
      inputs: [{ file: "absent" }, { file: "directory" }, { file: "file.bin" }, { present: "present" }, { present: "missing" }, { present: "directory" }],
      code: [],
    };
    expect(declaredInputFiles.inputKeyOf(declaration, project.root, context)).toBe("52d19669c00ca3548662352391eeb035b453cf4b4fdd79c6234329b70ffcb7bb");
  } finally { project.dispose(); }
});

test("presence probes ignore bytes but distinguish absent, file and directory", () => {
  const project = temporaryProjects.open("kit-input-probe-");
  try {
    const declaration = { name: "probe", inputs: [{ present: "probe" }], code: [] };
    const current = () => declaredInputFiles.inputKeyOf(declaration, project.root, context);
    const absent = current();
    project.write({ probe: "first" });
    const file = current();
    expect(file).not.toBe(absent);
    project.write({ probe: "other bytes" });
    expect(current()).toBe(file);
    project.remove("probe");
    project.directory("probe");
    const directory = current();
    expect(directory).not.toBe(file);
    expect(directory).not.toBe(absent);
    project.write({ "probe/child": "not read by a kind-only probe" });
    expect(current()).toBe(directory);
    project.remove("probe");
    expect(current()).toBe(absent);
  } finally { project.dispose(); }
});

test("absent content paths and empty trees preserve old omission semantics until content appears", () => {
  const project = temporaryProjects.open("kit-input-absent-");
  try {
    const empty = key("proof", new Map(), new Map());
    const declaration = { name: "proof", inputs: [{ file: "absent" }, { file: "absent/child" }, { tree: "empty", suffix: ".txt" }], code: [] };
    const current = () => declaredInputFiles.inputKeyOf(declaration, project.root, context);
    expect(current()).toBe(empty);
    project.directory("empty");
    expect(current()).toBe(empty);
    project.write({ absent: "new content" });
    expect(current()).not.toBe(empty);
    expect(declaredInputFiles.resolveInputs(project.root, [{ file: "absent/child" }])).toEqual([]);
  } finally { project.dispose(); }
});

test("direct directory declarations bind directory state but not directory contents", () => {
  const project = temporaryProjects.open("kit-input-directory-");
  try {
    const declaration = { name: "proof", inputs: [{ file: "path" }], code: [] };
    const current = () => declaredInputFiles.inputKeyOf(declaration, project.root, context);
    const absent = current();
    project.directory("path");
    const directory = current();
    expect(directory).not.toBe(absent);
    project.write({ "path/child": "unread" });
    expect(current()).toBe(directory);
    project.remove("path");
    project.write({ path: "content" });
    expect(current()).not.toBe(directory);
    expect(current()).not.toBe(absent);
  } finally { project.dispose(); }
});

test("identical declared inputs in different roots have the same key and getters are read once", () => {
  const first = temporaryProjects.open("kit-input-first-");
  const second = temporaryProjects.open("kit-input-second-");
  try {
    for (const project of [first, second]) project.write({ data: "same", code: "same code" });
    let inputReads = 0;
    let codeReads = 0;
    const declaration: InputDeclaration = {
      name: "proof",
      get inputs() { inputReads++; return [{ file: "data" }]; },
      get code() { codeReads++; return [{ file: "code" }]; },
    };
    const a = declaredInputFiles.inputKeyOf(declaration, first.root, context);
    expect([inputReads, codeReads]).toEqual([1, 1]);
    expect(declaredInputFiles.inputKeyOf(declaration, second.root, context)).toBe(a);
    expect([inputReads, codeReads]).toEqual([2, 2]);
  } finally { first.dispose(); second.dispose(); }
});

test("stat-followed symlinks retain binary content, tree traversal and missing-target semantics", () => {
  const project = temporaryProjects.open("kit-input-links-");
  try {
    project.write({ "target/value.bin": new Uint8Array([255, 254]) });
    project.symlink("target/value.bin", "linked.bin");
    project.symlink("target", "linked-tree");
    project.symlink("absent", "dangling");
    expect(declaredInputFiles.resolveInputs(project.root, [{ tree: "linked-tree", suffix: ".bin" }])).toEqual(["linked-tree/value.bin"]);
    const declaration = { name: "proof", inputs: [{ file: "linked.bin" }, { file: "dangling" }], code: [] };
    const current = () => declaredInputFiles.inputKeyOf(declaration, project.root, context);
    const before = current();
    expect(before).toBe(key("proof", new Map([["linked.bin", new Uint8Array([255, 254])]]), new Map()));
    project.write({ "target/value.bin": new Uint8Array([255, 253]) });
    expect(current()).not.toBe(before);
  } finally { project.dispose(); }
});

test("unknown filesystem failures cannot become a reusable absent-input key", () => {
  const project = temporaryProjects.open("kit-input-errors-");
  try {
    project.symlink("loop", "loop");
    for (const inputs of [[{ file: "loop" }], [{ present: "loop" }], [{ tree: "loop", suffix: ".ts" }]]) {
      expect(() => declaredInputFiles.inputKeyOf({ name: "proof", inputs, code: [] }, project.root, context)).toThrow();
    }
    expect(() => declaredInputFiles.resolveInputs(project.root, [{ file: "loop" }])).toThrow();
  } finally { project.dispose(); }
});

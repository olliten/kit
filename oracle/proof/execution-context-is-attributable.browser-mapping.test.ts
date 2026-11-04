import { expect, test } from "vitest";
import type {
  BrowserFunction,
  BrowserSource,
  MappedPosition,
} from "../../src/core/primitives/browser-execution.js";
import {
  browserFunctionEvidence,
  decodeMappings,
  mappedPositionAt,
} from "../../src/core/readings/browser-function-evidence.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encoded(value: number): string {
  let unsigned = Math.abs(value) * 2 + (value < 0 ? 1 : 0);
  let text = "";
  do {
    const part = unsigned % 32;
    unsigned = Math.floor(unsigned / 32);
    text += ALPHABET[part + (unsigned > 0 ? 32 : 0)];
  } while (unsigned > 0);
  return text;
}

test("source-map fields retain their independent source, line, column and name deltas", () => {
  expect(
    decodeMappings(
      "0123456789\nabcdefghij",
      "AAAAA,KAAKC;EACLD",
      ["src/core/readings/read.ts"],
      ["outer", "inner"],
    ),
  ).toEqual([
    { offset: 0, source: "src/core/readings/read.ts", line: 0, col: 0, name: "outer" },
    { offset: 5, source: "src/core/readings/read.ts", line: 0, col: 5, name: "inner" },
    { offset: 11, source: undefined, line: 0, col: 0, name: null },
    { offset: 13, source: "src/core/readings/read.ts", line: 1, col: 0, name: "outer" },
  ]);
});

test("valid VLQ inputs decode across source and name identities without changing their coordinates", () => {
  const files = ["src/core/readings/a.ts", "src/core/readings/b.ts", "src/client/app.ts"];
  const names = ["outer", "read", "value"];
  const mismatches: unknown[] = [];
  for (let generated = 0; generated <= 24; generated++)
    for (let source = 0; source <= 2; source++)
      for (let line = 0; line <= 12; line++)
        for (let col = 0; col <= 64; col++)
          for (let name = 0; name <= 2; name++) {
            const tuple = [generated, source, line, col, name];
            const mapping = tuple.map(encoded).join("");
            const actual = decodeMappings("x".repeat(25), mapping, files, names);
            const expected = [{ offset: generated, source: files[source], line, col, name: names[name] }];
            if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push({ tuple, actual, expected });
          }
  expect(mismatches).toEqual([]);
});

test.each([
  ["unfinished VLQ", "g"],
  ["invalid base64 digit", "!"],
  ["overflowing VLQ", "gggggggggggggg"],
  ["two fields", "AA"],
  ["three fields", "AAA"],
  ["six fields", "AAAAAA"],
  ["negative generated column", "DAAA"],
  ["generated column past the script", "WAAA"],
  ["unknown source", "ACAA"],
  ["negative source line", "AADA"],
  ["negative source column", "AAAD"],
  ["unknown name", "AAAAC"],
  ["generated line past the script", "AAAA;AAAA"],
  ["generated columns out of order", "KAAA,DAAA"],
])("%s refuses rather than returning qualified positions", (_name, mappings) => {
  expect(() =>
    decodeMappings("0123456789", mappings, ["src/core/readings/read.ts"], ["outer"]),
  ).toThrow();
});

test("an unmapped segment ends the previous source's attribution", () => {
  const positions = decodeMappings("0123456789", "AAAA,K", ["src/core/readings/read.ts"]);
  expect(mappedPositionAt(positions, -1)).toBeUndefined();
  expect(mappedPositionAt(positions, 4)?.source).toBe("src/core/readings/read.ts");
  expect(mappedPositionAt(positions, 5)?.source).toBeUndefined();
  expect(mappedPositionAt(positions, 9)?.source).toBeUndefined();
});

test("a generated line without a mapping cannot inherit the previous line's original function", () => {
  const script = "function mapped() {}\nfunction missing() {}";
  const positions = decodeMappings(script, "AAAA;", [FILE]);
  const start = script.indexOf("function missing");
  expect(mappedPositionAt(positions, start)?.source ?? null).toBeNull();
  const evidence = browserFunctionEvidence(
    [
      {
        functionName: "missing",
        ranges: [{ startOffset: start, endOffset: script.length, count: 1 }],
      },
    ],
    positions,
    script.length,
    [SOURCE],
  );
  expect(evidence.complete).toBe(false);
  expect(evidence.lcov).toContain("FNDA:0,outer\n");
});

test("an invoked function on an explicitly unmapped segment leaves the context incomplete", () => {
  const script = "x".repeat(50);
  const positions = decodeMappings(script, "AAAA,U", [FILE]);
  const evidence = browserFunctionEvidence(
    [{ functionName: "missing", ranges: [{ startOffset: 10, endOffset: 20, count: 1 }] }],
    positions,
    script.length,
    [SOURCE],
  );
  expect(evidence.complete).toBe(false);
  expect(evidence.lcov).toContain("FNDA:0,outer\n");
});

test("an explicitly mapped external SDK function stays attributable without granting checked-source credit", () => {
  const script = "x".repeat(50);
  const positions = decodeMappings(script, "AAAA", [null]);
  expect(mappedPositionAt(positions, 10)?.source).toBeNull();
  expect(
    browserFunctionEvidence(
      [{ functionName: "sdk", ranges: [{ startOffset: 10, endOffset: 20, count: 1 }] }],
      positions,
      script.length,
      [],
    ),
  ).toEqual({ complete: true, loaded: [], lcov: "" });
});

const FILE = "src/core/readings/read.ts";
const TEXT = [
  "export function outer() {",
  "  function read() { return 1; }",
  "  return read();",
  "}",
  "export function read() { return 2; }",
].join("\n");
const SOURCE: BrowserSource = {
  file: FILE,
  text: TEXT,
  functions: [
    { file: FILE, name: "outer", line: 1, start: 0, end: TEXT.indexOf("\n}\n") + 2 },
    {
      file: FILE,
      name: "read",
      line: 2,
      start: TEXT.indexOf("function read"),
      end: TEXT.indexOf("return 1; }") + "return 1; }".length,
    },
    {
      file: FILE,
      name: "read",
      line: 5,
      start: TEXT.lastIndexOf("export function read"),
      end: TEXT.length,
    },
  ],
};
const POSITIONS: readonly MappedPosition[] = [
  { offset: 10, source: FILE, line: 1, col: 2, name: "read" },
  { offset: 40, source: FILE, line: 4, col: 0, name: "read" },
];

test("nested and repeated source function names preserve the exact Kit name and start-line identities", () => {
  const functions: BrowserFunction[] = [
    { functionName: "", ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] },
    { functionName: "minifiedA", ranges: [{ startOffset: 10, endOffset: 30, count: 2 }] },
    { functionName: "minifiedB", ranges: [{ startOffset: 40, endOffset: 70, count: 7 }] },
  ];
  const evidence = browserFunctionEvidence(functions, POSITIONS, 100, [SOURCE]);
  expect(evidence).toEqual({
    complete: true,
    loaded: [FILE],
    lcov: [
      `SF:${FILE}`,
      "FN:1,outer",
      "FN:2,read",
      "FN:5,read",
      "FNDA:0,outer",
      "FNDA:2,read",
      "FNDA:7,read",
      "end_of_record",
      "",
    ].join("\n"),
  });
});

test("a loaded application bootstrap stays in context even when none of its named functions runs", () => {
  const startup: BrowserSource = {
    file: "src/client/app.ts",
    text: "export function boot() {}",
    functions: [{ file: "src/client/app.ts", name: "boot", line: 1, start: 0, end: 25 }],
  };
  const evidence = browserFunctionEvidence(
    [],
    [{ offset: 0, source: startup.file, line: 0, col: 0, name: null }, ...POSITIONS],
    100,
    [SOURCE, startup],
  );
  expect(evidence.complete).toBe(true);
  expect(evidence.loaded).toEqual(["src/client/app.ts", FILE].sort());
  expect(evidence.lcov).toContain("FNDA:0,boot");
});

test("same-name functions on the same original line cannot silently credit each other", () => {
  const text = "const a={read(){return 1}}; const b={read(){return 2}};";
  const first = text.indexOf("read");
  const second = text.lastIndexOf("read");
  const source: BrowserSource = {
    file: FILE,
    text,
    functions: [
      { file: FILE, name: "read", line: 1, start: first, end: second - 1 },
      { file: FILE, name: "read", line: 1, start: second, end: text.length - 1 },
    ],
  };
  const evidence = browserFunctionEvidence(
    [{ functionName: "a", ranges: [{ startOffset: 10, endOffset: 20, count: 1 }] }],
    [{ offset: 10, source: FILE, line: 0, col: first, name: "read" }],
    100,
    [source],
  );
  expect(evidence.complete).toBe(false);
});

test.each([
  { source: "src/core/readings/missing.ts", line: 0, col: 0 },
  { source: FILE, line: 99, col: 0 },
  { source: FILE, line: 0, col: 999 },
  { source: FILE, line: -1, col: 0 },
])(
  "unattributable original position $source:$line:$col makes the whole context incomplete",
  (position) => {
    const evidence = browserFunctionEvidence([], [{ ...position, offset: 0, name: null }], 100, [
      SOURCE,
    ]);
    expect(evidence.complete).toBe(false);
  },
);

test.each([
  { startOffset: -1, endOffset: 30, count: 1 },
  { startOffset: 10, endOffset: 101, count: 1 },
  { startOffset: 30, endOffset: 10, count: 1 },
  { startOffset: 10, endOffset: 30, count: -1 },
  { startOffset: 10.5, endOffset: 30, count: 1 },
])("invalid invoked function range $startOffset–$endOffset grants no complete context", (range) => {
  expect(
    browserFunctionEvidence([{ functionName: "read", ranges: [range] }], POSITIONS, 100, [SOURCE])
      .complete,
  ).toBe(false);
});

test("an invoked function without an original source function receives no credit", () => {
  expect(
    browserFunctionEvidence(
      [{ functionName: "unknown", ranges: [{ startOffset: 1, endOffset: 3, count: 1 }] }],
      POSITIONS,
      100,
      [SOURCE],
    ).complete,
  ).toBe(false);
});

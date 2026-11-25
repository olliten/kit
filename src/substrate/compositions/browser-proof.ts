import { createHash } from "node:crypto";
import type {
  BrowserContextRecord,
  BrowserFunctionSite,
  BrowserMapArtifact,
  BrowserSource,
} from "../../core/primitives/browser-execution.js";
import { browserFunctionEvidence, decodeMappings } from "../../core/readings/browser-function-evidence.js";
import { browserMapOf } from "../../core/readings/browser-map.js";
import type { BrowserCaptureSession } from "../adapters/browser-capture.js";
import { textFiles } from "../adapters/text-files.js";

export interface BrowserProof {
  readonly done: () => Promise<void>;
}

// The proof's own environment as `kit verify` gives it: `KIT_COVERAGE`, `KIT_TEST`, `KIT_RUNTIME`, `KIT_ROOT`
// and `KIT_FUNCTIONS`.
export interface BrowserProofEnvironment {
  readonly coverage: string | undefined;
  readonly test: string | undefined;
  readonly runtime: string | undefined;
  readonly root?: string | undefined;
  readonly functions?: string | undefined;
}

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// An app-relative path with its `.` and `..` parts resolved, or undefined when it leaves the app.
function appPath(base: string, path: string): string | undefined {
  if (path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return undefined;
  const parts: string[] = [];
  for (const part of `${base}/${path}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.pop() === undefined) return undefined;
    } else parts.push(part);
  }
  return parts.length === 0 ? undefined : parts.join("/");
}

function inventoryOf(text: string): readonly BrowserFunctionSite[] | undefined {
  const parsed: unknown = JSON.parse(text);
  if (!record(parsed) || !Array.isArray(parsed["functions"])) return undefined;
  return parsed["functions"].flatMap((fn: unknown): BrowserFunctionSite[] =>
    record(fn) && typeof fn["file"] === "string" && typeof fn["name"] === "string" && typeof fn["line"] === "number" &&
    typeof fn["start"] === "number" && typeof fn["end"] === "number"
      ? [{ file: fn["file"], name: fn["name"], line: fn["line"], start: fn["start"], end: fn["end"] }]
      : [],
  );
}

interface Attribution {
  complete: boolean;
  readonly loaded: Set<string>;
  readonly lcov: string[];
}

// One matched script's coverage, through its map, to the original sources' named functions. A map source under
// `node_modules` is external; one that leaves the app, or whose file is missing or unlike the map's copy, is not
// attributable.
function attribute(
  script: { readonly source: string; readonly functions: Parameters<typeof browserFunctionEvidence>[0] },
  entry: BrowserMapArtifact["scripts"][number],
  root: string,
  inventory: readonly BrowserFunctionSite[],
  into: Attribution,
): void {
  const map: unknown = JSON.parse(textFiles.read(`${root}/${entry.map}`));
  if (!record(map) || map["version"] !== 3 || typeof map["mappings"] !== "string" || !Array.isArray(map["sources"])) {
    into.complete = false;
    return;
  }
  const sourceRoot = typeof map["sourceRoot"] === "string" ? map["sourceRoot"] : "";
  const contents = Array.isArray(map["sourcesContent"]) ? map["sourcesContent"] : [];
  const sources: BrowserSource[] = [];
  const paths = map["sources"].map((source: unknown, index: number): string | null => {
    const path = typeof source === "string" ? appPath(entry.base, `${sourceRoot}${source}`) : undefined;
    if (path !== undefined && path.split("/").includes("node_modules")) return null;
    if (path === undefined || !textFiles.exists(`${root}/${path}`)) {
      into.complete = false;
      return null;
    }
    const text = textFiles.read(`${root}/${path}`);
    const content: unknown = contents[index];
    if (typeof content === "string" && content !== text) into.complete = false;
    sources.push({ file: path, text, functions: inventory.filter((site) => site.file === path) });
    return path;
  });
  const names = Array.isArray(map["names"]) ? map["names"].filter((name: unknown): name is string => typeof name === "string") : [];
  try {
    const evidence = browserFunctionEvidence(script.functions, decodeMappings(script.source, map["mappings"], paths, names), script.source.length, sources);
    if (!evidence.complete) into.complete = false;
    for (const path of evidence.loaded) into.loaded.add(path);
    if (evidence.lcov !== "") into.lcov.push(evidence.lcov);
  } catch {
    into.complete = false;
  }
}

// What a started capture becomes once the proof is done: the test's browser runs and context, in its own report
// directory. Outside `kit verify` nothing is written; a capture that cannot be attributed is written incomplete.
export function recordBrowserProof(
  session: BrowserCaptureSession,
  options: { readonly maps: string },
  environment: BrowserProofEnvironment,
): BrowserProof {
  const { coverage, test, runtime, root, functions } = environment;
  if (coverage === undefined || test === undefined || runtime === undefined) return { done: async () => {} };
  return {
    async done() {
      const captured = await session.take();
      const into: Attribution = { complete: captured.complete, loaded: new Set(), lcov: [] };
      try {
        const path = options.maps.startsWith("/") || root === undefined ? options.maps : `${root}/${options.maps}`;
        const maps = textFiles.exists(path) ? browserMapOf(JSON.parse(textFiles.read(path))) : undefined;
        const inventory = functions !== undefined && textFiles.exists(functions) ? inventoryOf(textFiles.read(functions)) : undefined;
        if (maps === undefined || inventory === undefined || root === undefined) into.complete = false;
        else
          for (const script of captured.scripts) {
            const digest = createHash("sha256").update(script.source).digest("hex");
            const entry = maps.scripts.find((each) => each.scriptHash === digest);
            if (entry !== undefined) attribute(script, entry, root, inventory, into);
            else if (script.url !== "" && !maps.external.some((prefix) => script.url.startsWith(prefix))) into.complete = false;
          }
      } catch {
        into.complete = false;
      }
      const directory = `${coverage}/${encodeURIComponent(test)}`;
      textFiles.directory(directory);
      if (into.lcov.length > 0) textFiles.write(`${directory}/browser.info`, into.lcov.join(""));
      const context: BrowserContextRecord = { complete: into.complete, loaded: [...into.loaded].sort(), runtime };
      textFiles.write(`${directory}/browser-context.json`, JSON.stringify(context));
    },
  };
}

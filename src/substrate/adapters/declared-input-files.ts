import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  FileMap,
  InputDecl,
  InputDeclaration,
  KeyContext,
} from "../../core/primitives/declared-input.js";

export interface DeclaredInputFiles {
  resolveInputs(root: string, declarations: readonly InputDecl[]): string[];
  inputKey(name: string, inputs: FileMap, code: FileMap, context: KeyContext): string;
  inputKeyOf(declaration: InputDeclaration, root: string, context: KeyContext): string;
}

function frame(hash: ReturnType<typeof createHash>, bytes: Uint8Array): void {
  const length = new Uint8Array(8);
  new DataView(length.buffer).setBigUint64(0, BigInt(bytes.length), true);
  hash.update(length);
  hash.update(bytes);
}

function text16(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return bytes;
}

function keyOver(
  name: string,
  inputs: FileMap,
  code: FileMap,
  context: KeyContext,
  inputDirectories: readonly string[] = [],
  codeDirectories: readonly string[] = [],
  inputKinds: readonly (readonly [string, string])[] = [],
  codeKinds: readonly (readonly [string, string])[] = [],
): string {
  const hash = createHash("sha256");
  const text = (value: string): void => frame(hash, text16(value));
  text(context.format);
  text(context.runtime);
  text(name);
  for (const [domain, files] of [["inputs", inputs], ["code", code]] as const) {
    text(domain);
    const paths = [...files.keys()].sort();
    text(String(paths.length));
    for (const path of paths) {
      text(path);
      const content = files.get(path);
      if (content === undefined) throw new Error(`Missing declared input ${path}`);
      frame(hash, typeof content === "string" ? new TextEncoder().encode(content) : content);
    }
  }
  for (const [domain, directories] of [
    ["input directories", inputDirectories],
    ["code directories", codeDirectories],
  ] as const) {
    text(domain);
    const paths = [...new Set(directories)].sort();
    text(String(paths.length));
    for (const path of paths) text(path);
  }
  for (const [domain, kinds] of [["input presence", inputKinds], ["code presence", codeKinds]] as const) {
    text(domain);
    const entries = [...new Map(kinds)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    text(String(entries.length));
    for (const [path, kind] of entries) {
      text(path);
      text(kind);
    }
  }
  return hash.digest("hex");
}

function kindOf(path: string): "file" | "dir" | null {
  try {
    const stat = statSync(path);
    return stat.isDirectory() ? "dir" : stat.isFile() ? "file" : null;
  } catch (error) {
    if (error instanceof Error && "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

function resolveInputs(root: string, declarations: readonly InputDecl[]): string[] {
  const files = new Set<string>();
  const walk = (relative: string, suffix: string): void => {
    for (const name of readdirSync(join(root, relative))) {
      const child = relative === "" ? name : `${relative}/${name}`;
      const kind = kindOf(join(root, child));
      if (kind === "dir") walk(child, suffix);
      else if (kind === "file" && name.endsWith(suffix)) files.add(child);
    }
  };
  for (const declaration of declarations) {
    if ("present" in declaration) continue;
    if ("file" in declaration) {
      if (kindOf(join(root, declaration.file)) === "file") files.add(declaration.file);
    } else if (kindOf(join(root, declaration.tree)) === "dir") {
      walk(declaration.tree, declaration.suffix);
    }
  }
  return [...files].sort();
}

function inputKeyOf(declaration: InputDeclaration, root: string, context: KeyContext): string {
  const { name, inputs, code } = declaration;
  const filesOf = (declarations: readonly InputDecl[]): FileMap =>
    new Map(resolveInputs(root, declarations).map((path) => [path, readFileSync(join(root, path))]));
  const directoriesOf = (declarations: readonly InputDecl[]): string[] =>
    declarations.flatMap((item) => "file" in item && kindOf(join(root, item.file)) === "dir" ? [item.file] : []);
  const kindsOf = (declarations: readonly InputDecl[]): [string, string][] =>
    declarations.flatMap((item) => "present" in item
      ? [[item.present, kindOf(join(root, item.present)) ?? "absent"] as [string, string]] : []);
  return keyOver(name, filesOf(inputs), filesOf(code), context,
    directoriesOf(inputs), directoriesOf(code), kindsOf(inputs), kindsOf(code));
}

export const declaredInputFiles: DeclaredInputFiles = {
  resolveInputs,
  inputKey: (name, inputs, code, context) => keyOver(name, inputs, code, context),
  inputKeyOf,
};

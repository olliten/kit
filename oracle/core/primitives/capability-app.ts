// The capability case app, as data: the ordinary source inputs that the structural cases in case-inventory
// name by path. A proof writes it into a temporary project and reads or loads it there. Inputs stay separate
// from the oracle's expected outcomes: checks consume the real snapshot reader's facts and the declared adapter
// roster, never expected findings, and no module declares its own purity.
export const CAPABILITY_APP: Readonly<Record<string, string>> = {
  "src/core/compositions/dynamic-constructor.ts": `export function createCode(code: string): unknown {
  const result: unknown = new Function(code);
  return result;
}
`,
  "src/core/compositions/dynamic-eval.ts": `export function runCode(code: string): unknown {
  const result: unknown = eval(code);
  return result;
}
`,
  "src/core/compositions/dynamic-function.ts": `export function createCode(code: string): unknown {
  const result: unknown = Function(code);
  return result;
}
`,
  "src/core/compositions/dynamic-import.ts": `export async function load(): Promise<unknown> {
  return import("unsupported-library");
}
`,
  "src/core/compositions/local-method.ts": `import { PlainValue } from "../legacy/plain-method.js";

export function value(): number {
  return new PlainValue().value();
}
`,
  "src/core/compositions/plain-value.ts": `export function plainValue(): number {
  return 7;
}
`,
  "src/core/compositions/run.ts": `export function run(read: () => number): number {
  return read();
}
`,
  "src/core/compositions/save-value.ts": `import { writeDescription } from "./write-description.js";
import type { WriteDescription } from "../primitives/write-description.js";
import { validValue } from "../readings/valid-value.js";

export type SaveResult =
  | { readonly kind: "invalid"; readonly reason: string }
  | { readonly kind: "accepted"; readonly writes: readonly WriteDescription[] };

export function saveValue(key: string, value: string, limit: number): SaveResult {
  if (!validValue(value, limit)) return { kind: "invalid", reason: "value-too-long" };
  return { kind: "accepted", writes: [writeDescription(key, value)] };
}
`,
  "src/core/compositions/separate-unknown-calls.ts": `export function inspect(key: string): { readonly dynamic: unknown; readonly ambient: number } {
  const dynamic: unknown = Reflect.get(globalThis, key);
  const ambient: number = ambientRead();
  return { dynamic, ambient };
}
`,
  "src/core/compositions/union-description.ts": `import type { UnionDescription } from "../primitives/union-description.js";

export function putDescription(value: string): UnionDescription {
  return { kind: "put", value };
}
`,
  "src/core/compositions/value-status.ts": `import { validValue } from "../readings/valid-value.js";

export function valueStatus(value: string, limit: number): boolean {
  return validValue(value, limit);
}
`,
  "src/core/compositions/write-description.ts": `import type { WriteDescription } from "../primitives/write-description.js";

export function writeDescription(key: string, value: string): WriteDescription {
  return { kind: "put-cell", key, value };
}
`,
  "src/core/legacy/clock.ts": `export interface Stamp {
  readonly value: number;
}

export function clock(): number {
  return Date.now();
}
`,
  "src/core/legacy/plain-method.ts": `export class PlainValue {
  value(): number {
    return 7;
  }
}
`,
  "src/core/primitives/aliased-randomness.ts": `const sample: () => number = Math.random;

export function freshValue(): number {
  return sample();
}
`,
  "src/core/primitives/ambient-acquisition.ts": `export const acquired: typeof ambientRead = ambientRead;
`,
  "src/core/primitives/ambient-type.ts": `export type AmbientShape = typeof ambientRead;
`,
  "src/core/primitives/destructured-randomness.ts": `const { random: sample } = Math;
export const draw: typeof Math.random = sample;
`,
  "src/core/primitives/dynamic-access.ts": `export function dynamicValue(key: string): unknown {
  const value: unknown = Reflect.get(globalThis, key);
  return value;
}
`,
  "src/core/primitives/eval-acquisition.ts": `export const execute: typeof eval = eval;
`,
  "src/core/primitives/exported-randomness.ts": `export const sample: () => number = Math.random;
`,
  "src/core/primitives/random-shape.ts": `export type RandomShape = typeof Math.random;
`,
  "src/core/primitives/raw-clock.ts": `export function currentInstant(): number {
  return Date.now();
}
`,
  "src/core/primitives/readonly-roster.ts": `export const roster = [{ key: "one", enabled: true }] as const;
`,
  "src/core/primitives/schema.ts": `export interface Cell {
  readonly key: string;
  readonly value: string;
}
export type Choice = "keep" | "remove";
export const choices: readonly Choice[] = ["keep", "remove"];
`,
  "src/core/primitives/scored-value.ts": `export interface ScoredValue {
  readonly id: string;
  readonly limit: number | null;
  readonly offset: number;
}
`,
  "src/core/primitives/union-description.ts": `export type UnionDescription =
  | { readonly kind: "put"; readonly value: string }
  | { readonly kind: "remove"; readonly key: string };
`,
  "src/core/primitives/up-edge.ts": `import { plainValue } from "../compositions/plain-value.js";

export function value(): number {
  return plainValue();
}
`,
  "src/core/primitives/write-description.ts": `export interface WriteDescription {
  readonly kind: "put-cell";
  readonly key: string;
  readonly value: string;
}
`,
  "src/core/readings/adjusted-limit.ts": `import type { ScoredValue } from "../primitives/scored-value.js";

export function adjustedLimit(value: ScoredValue): number | null {
  return value.limit === null ? null : value.limit - value.offset;
}
`,
  "src/core/readings/ambient-call.ts": `export function ambientValue(): number {
  return ambientRead();
}
`,
  "src/core/readings/ambient-shadow.ts": `export function readValue(): number {
  const ambientRead: () => number = () => 7;
  return ambientRead();
}
`,
  "src/core/readings/cast-production.ts": `import type { WriteDescription } from "../primitives/write-description.js";

export function forged(): WriteDescription {
  return { kind: "put-cell", key: "one", value: "changed" } as WriteDescription;
}
`,
  "src/core/readings/compare-value.ts": `import type { ScoredValue } from "../primitives/scored-value.js";
import { adjustedLimit } from "./adjusted-limit.js";

export function compareValue(left: ScoredValue, right: ScoredValue): number {
  const a = adjustedLimit(left);
  const b = adjustedLimit(right);
  if (a === null) return b === null ? left.id.localeCompare(right.id) : 1;
  if (b === null) return -1;
  return a - b || left.id.localeCompare(right.id);
}
`,
  "src/core/readings/cycle-one.ts": `import { two } from "./cycle-two.js";

export function one(): number {
  return two();
}
`,
  "src/core/readings/cycle-two.ts": `import { one } from "./cycle-one.js";

export function two(): number {
  return one();
}
`,
  "src/core/readings/data-input.ts": `export interface Input {
  readonly value: string;
  readonly options: { readonly trim: boolean };
}

export function transformedValue(input: Input): string {
  return input.options.trim ? input.value.trim() : input.value;
}
`,
  "src/core/readings/description-target.ts": `import type { WriteDescription } from "../primitives/write-description.js";

export function descriptionTarget(description: WriteDescription): string {
  return description.key;
}
`,
  "src/core/readings/destructured-values.ts": `import { draw } from "../primitives/destructured-randomness.js";

export function values(): readonly number[] {
  return [1, 2].map(draw);
}
`,
  "src/core/readings/function-result.ts": `function value(input: string | undefined): string | undefined {
  return input;
}

export function text(input: string | undefined): string {
  return value(input)!;
}
`,
  "src/core/readings/getter-input.ts": `export const input: { readonly value: string } = {
  get value(): string {
    return "read";
  },
};
`,
  "src/core/readings/indexed-cast.ts": `export function first(values: readonly (string | undefined)[]): string {
  return values[0] as string;
}
`,
  "src/core/readings/indexed-value.ts": `export function first(values: readonly string[]): string {
  return values[0]!;
}

export function capture(value: string): string {
  const match = /^(.*)$/.exec(value);
  if (match === null) return "";
  return match[1]!;
}
`,
  "src/core/readings/inferred-spread.ts": `import type { WriteDescription } from "../primitives/write-description.js";

export function reconstructed(description: WriteDescription): WriteDescription {
  const inferred = { ...description, key: "other" };
  return inferred;
}
`,
  "src/core/readings/instance-input.ts": `export class WithMethod {
  value(): string {
    return "read";
  }
}

export const input: WithMethod = new WithMethod();
`,
  "src/core/readings/legacy-clock.ts": `import { clock } from "../legacy/clock.js";

export function current(): number {
  return clock();
}
`,
  "src/core/readings/legacy-shape.ts": `import type { Stamp } from "../legacy/clock.js";

export function value(stamp: Stamp): number {
  return stamp.value;
}
`,
  "src/core/readings/literal-production.ts": `import type { WriteDescription } from "../primitives/write-description.js";

export function forged(): WriteDescription {
  return { kind: "put-cell", key: "one", value: "changed" };
}
`,
  "src/core/readings/mapped-randomness.ts": `import { sample } from "../primitives/exported-randomness.js";

export function sampled(values: readonly number[]): readonly number[] {
  return values.map(sample);
}
`,
  "src/core/readings/nested-callback.ts": `export interface Input {
  readonly value: string;
  readonly options: {
    readonly transform: (value: string) => string;
  };
}

export function transformedValue(input: Input): string {
  return input.options.transform(input.value);
}
`,
  "src/core/readings/optional-property.ts": `export function text(input: { readonly value?: string }): string {
  return input.value!;
}
`,
  "src/core/readings/outward-edge.ts": `import { plainText } from "../../substrate/primitives/plain-text.js";

export function text(value: string): string {
  return plainText(value);
}
`,
  "src/core/readings/proxy-input.ts": `export const input: { readonly value: string } = new Proxy(
  { value: "read" },
  { get: () => "intercepted" },
);
`,
  "src/core/readings/spread-copy.ts": `import type { WriteDescription } from "../primitives/write-description.js";

export function copied(description: WriteDescription): WriteDescription {
  return { ...description, value: "other" };
}
`,
  "src/core/readings/spread-reconstruction.ts": `import type { WriteDescription } from "../primitives/write-description.js";

export function reconstructed(description: WriteDescription): WriteDescription {
  return { ...description, key: "other" };
}
`,
  "src/core/readings/supplied-comparator.ts": `import type { ScoredValue } from "../primitives/scored-value.js";

export function valueOrder(
  values: readonly ScoredValue[],
  compare: (left: ScoredValue, right: ScoredValue) => number,
): readonly string[] {
  return [...values].sort(compare).map((value) => value.id);
}
`,
  "src/core/readings/time-conversion.ts": `export function seconds(instantMilliseconds: number): number {
  return instantMilliseconds / 1000;
}
`,
  "src/core/readings/union-literal.ts": `import type { UnionDescription } from "../primitives/union-description.js";

export function fabricated(value: string): UnionDescription {
  return { kind: "put", value };
}
`,
  "src/core/readings/union-spread.ts": `import type { UnionDescription } from "../primitives/union-description.js";

export function reconstructed(description: UnionDescription): UnionDescription {
  return { ...description };
}
`,
  "src/core/readings/unknown-provenance.ts": `import { externalValue } from "unsupported-library";

export function valueText(input: { readonly value: string }): string {
  return input.value;
}

export const text: string = valueText(externalValue);
`,
  "src/core/readings/valid-value.ts": `export function validValue(value: string, limit: number): boolean {
  return value.length <= limit;
}
`,
  "src/core/readings/value-order.ts": `import type { ScoredValue } from "../primitives/scored-value.js";
import { compareValue } from "./compare-value.js";

export function valueOrder(values: readonly ScoredValue[]): readonly string[] {
  return [...values].sort(compareValue).map((value) => value.id);
}
`,
  "src/substrate/adapters/clock.ts": `export function clock(): number {
  return Date.now();
}
`,
  "src/substrate/compositions/clock-probe.ts": `import { run } from "../../core/compositions/run.js";
import { clock } from "../adapters/clock.js";

const read: () => number = () => clock();
export const value: number = run(read);
`,
  "src/substrate/compositions/closure-description.ts": `import type { CellWriter } from "../primitives/cell-store.js";

export interface Description {
  readonly apply: () => void;
}

export function description(writer: CellWriter): Description {
  return { apply: () => writer.put({ key: "one", value: "saved" }) };
}
`,
  "src/substrate/compositions/nested-description.ts": `import type { CellWriter } from "../primitives/cell-store.js";

export function saveLater(
  writer: CellWriter,
  value: string,
): { readonly operation: { readonly run: () => void } } {
  return { operation: { run: () => writer.put({ key: "one", value }) } };
}
`,
  "src/substrate/compositions/pure-probe.ts": `import { run } from "../../core/compositions/run.js";

const read: () => number = () => 7;
export const value: number = run(read);
`,
  "src/substrate/compositions/unknown-connection.ts": `import { externalUse } from "unsupported-library";
import { clock } from "../adapters/clock.js";

const read: () => number = () => clock();
export const value: number = externalUse(read);
`,
  "src/substrate/primitives/ambient.ts": `export function acquireAmbient(): number {
  return ambientRead();
}
`,
  "src/substrate/primitives/anonymous-store.ts": `export function put(writer: { readonly put: (value: string) => void }, value: string): void {
  writer.put(value);
}
`,
  "src/substrate/primitives/apply-description.ts": `import type { WriteDescription } from "../../core/primitives/write-description.js";

export interface DescriptionWriter {
  readonly put: (description: WriteDescription) => void;
}

export function applyDescription(writer: DescriptionWriter, description: WriteDescription): void {
  writer.put(description);
}
`,
  "src/substrate/primitives/broad-service.ts": `export interface BroadService {
  readonly read: (key: string) => string;
  readonly put: (key: string, value: string) => void;
  readonly remove: (key: string) => void;
}

export function save(service: BroadService, key: string, value: string): void {
  service.put(key, value);
}
`,
  "src/substrate/primitives/cell-exports.ts": `export { cleanText, writeCell } from "./cell-store.js";
`,
  "src/substrate/primitives/cell-store.ts": `import type { Cell } from "../../core/primitives/schema.js";

export interface CellWriter {
  readonly put: (cell: Cell) => void;
}

export function writeCell(writer: CellWriter, cell: Cell): void {
  writer.put(cell);
}

export function cleanText(value: string): string {
  return value.trim();
}
`,
  "src/substrate/primitives/plain-text.ts": `export function plainText(value: string): string {
  return value.trim();
}
`,
  "src/substrate/readings/cell-shape.ts": `import type { Cell } from "../../core/primitives/schema.js";
import type { CellWriter } from "../primitives/cell-store.js";

export type WriterShape = CellWriter;

export function cellShape(cell: Cell): readonly [string, string] {
  return [cell.key, cell.value];
}
`,
  "src/substrate/readings/clean-cell.ts": `import { cleanText } from "../primitives/cell-exports.js";

export function cleanCell(value: string): string {
  return cleanText(value);
}
`,
  "src/substrate/readings/parameter-only-write.ts": `import type { Cell } from "../../core/primitives/schema.js";
import type { CellWriter } from "../primitives/cell-store.js";

export function readViaPort(writer: CellWriter, cell: Cell): string {
  writer.put(cell);
  return cell.value;
}
`,
  "src/substrate/readings/write-cell.ts": `import type { Cell } from "../../core/primitives/schema.js";
import { writeCell } from "../primitives/cell-store.js";
import type { CellWriter } from "../primitives/cell-store.js";

export function writeAndRead(writer: CellWriter, cell: Cell): string {
  writeCell(writer, cell);
  return cell.value;
}
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": [],
    "strict": true,
    "noEmit": true,
    "declaration": true,
    "isolatedDeclarations": true
  },
  "include": ["src/**/*.ts", "types/**/*.d.ts"]
}
`,
  "types/unsupported-library.d.ts": `declare module "unsupported-library" {
  export const externalValue: { readonly value: string };
  export function externalUse(read: () => number): number;
}

declare function ambientRead(): number;
`,
};

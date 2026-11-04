import type {
  BrowserFunction,
  BrowserFunctionSite,
  BrowserProofEvidence,
  BrowserSource,
  MappedPosition,
} from "../primitives/browser-execution.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(segment: string, cursor: number): readonly [number, number] {
  let value = 0;
  let factor = 1;
  for (;;) {
    const character = segment[cursor++];
    const digit = character === undefined ? -1 : ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("browser mapping has an invalid or unfinished VLQ field");
    value += (digit & 31) * factor;
    if (!Number.isSafeInteger(value)) throw new Error("browser mapping VLQ field is too large");
    if ((digit & 32) === 0) return [(value % 2 === 0 ? 1 : -1) * Math.floor(value / 2), cursor];
    factor *= 32;
    if (!Number.isSafeInteger(factor)) throw new Error("browser mapping VLQ field is too large");
  }
}

export function decodeMappings(
  text: string,
  mappings: string,
  sources: readonly (string | null)[],
  names: readonly string[] = [],
): MappedPosition[] {
  const out: MappedPosition[] = [];
  let lineStart = 0;
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let name = 0;
  for (const line of mappings.split(";")) {
    let column = 0;
    const end = text.indexOf("\n", lineStart);
    const lineEnd = end < 0 ? text.length : end;
    for (const segment of line.split(",")) {
      if (segment === "") continue;
      const fields: number[] = [];
      for (let cursor = 0; cursor < segment.length; ) {
        const [field, next] = vlq(segment, cursor);
        fields.push(field);
        cursor = next;
      }
      if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5)
        throw new Error("browser mapping segment has an invalid field count");
      if ((fields[0] ?? 0) < 0)
        throw new Error("browser mapping generated positions are not ordered");
      column += fields[0] ?? 0;
      if (column < 0 || lineStart + column > lineEnd)
        throw new Error("browser mapping generated position is outside its script");
      if (fields.length === 1) {
        out.push({ offset: lineStart + column, source: undefined, line: 0, col: 0, name: null });
        continue;
      }
      source += fields[1] ?? 0;
      sourceLine += fields[2] ?? 0;
      sourceColumn += fields[3] ?? 0;
      if (source < 0 || source >= sources.length || sourceLine < 0 || sourceColumn < 0)
        throw new Error("browser mapping original position is outside its source inventory");
      let identifier: string | null = null;
      if (fields.length === 5) {
        name += fields[4] ?? 0;
        identifier = names[name] ?? null;
        if (identifier === null) throw new Error("browser mapping names an unknown identifier");
      }
      out.push({
        offset: lineStart + column,
        source: sources[source] ?? null,
        line: sourceLine,
        col: sourceColumn,
        name: identifier,
      });
    }
    if (end < 0) {
      lineStart = text.length + 1;
    } else {
      lineStart = end + 1;
      if (lineStart < text.length)
        out.push({ offset: lineStart, source: undefined, line: 0, col: 0, name: null });
    }
  }
  return out;
}

export function mappedPositionAt(
  positions: readonly MappedPosition[],
  offset: number,
): MappedPosition | undefined {
  let left = 0;
  let right = positions.length - 1;
  let result: MappedPosition | undefined;
  while (left <= right) {
    const index = Math.floor((left + right) / 2);
    const position = positions[index];
    if (position !== undefined && position.offset <= offset) {
      result = position;
      left = index + 1;
    } else right = index - 1;
  }
  return result;
}

function sourceOffset(source: BrowserSource, position: MappedPosition): number | undefined {
  const lines = source.text.split("\n");
  const line = lines[position.line];
  if (
    !Number.isSafeInteger(position.line) ||
    !Number.isSafeInteger(position.col) ||
    line === undefined ||
    position.col < 0 ||
    position.col > line.length
  )
    return undefined;
  return (
    lines.slice(0, position.line).reduce((sum, text) => sum + text.length + 1, 0) + position.col
  );
}

function functionAt(
  source: BrowserSource,
  position: MappedPosition,
): BrowserFunctionSite | undefined {
  const offset = sourceOffset(source, position);
  if (offset === undefined) return undefined;
  return source.functions
    .filter((site) => site.file === source.file && site.start <= offset && offset < site.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
}

export function browserFunctionEvidence(
  functions: readonly BrowserFunction[],
  positions: readonly MappedPosition[],
  scriptLength: number,
  sources: readonly BrowserSource[],
): BrowserProofEvidence {
  const inventory = new Map(sources.map((source) => [source.file, source]));
  const loaded = new Set(
    positions.flatMap((position) => (typeof position.source === "string" ? [position.source] : [])),
  );
  const counts = new Map<BrowserFunctionSite, number>();
  let complete = [...loaded].every((file) => inventory.has(file));
  for (const file of loaded) {
    const identities = new Map<string, Set<string>>();
    for (const site of inventory.get(file)?.functions ?? []) {
      const identity = `${site.name}@${site.line}`;
      const spans = identities.get(identity) ?? new Set<string>();
      spans.add(`${site.start}:${site.end}`);
      identities.set(identity, spans);
      if (spans.size > 1) complete = false;
    }
  }
  for (const position of positions) {
    if (position.source === null || position.source === undefined) continue;
    const source = inventory.get(position.source);
    if (source === undefined || sourceOffset(source, position) === undefined) complete = false;
  }
  for (const fn of functions) {
    const range = fn.ranges[0];
    if (range === undefined || range.count === 0) continue;
    if (
      ![range.startOffset, range.endOffset, range.count].every(Number.isSafeInteger) ||
      range.startOffset < 0 ||
      range.endOffset > scriptLength ||
      range.endOffset <= range.startOffset ||
      range.count < 0
    ) {
      complete = false;
      continue;
    }
    if (range.startOffset === 0 && range.endOffset === scriptLength) continue;
    const position = mappedPositionAt(positions, range.startOffset);
    if (position?.source === null) continue;
    const source = position?.source === undefined ? undefined : inventory.get(position.source);
    const site =
      source === undefined || position === undefined ? undefined : functionAt(source, position);
    if (site === undefined) complete = false;
    else counts.set(site, (counts.get(site) ?? 0) + range.count);
  }
  const records = [...loaded].sort().flatMap((file) => {
    const source = inventory.get(file);
    if (source === undefined) return [];
    return [
      `SF:${file}`,
      ...source.functions.map((site) => `FN:${site.line},${site.name}`),
      ...source.functions.map((site) => `FNDA:${counts.get(site) ?? 0},${site.name}`),
      "end_of_record",
    ];
  });
  return {
    complete,
    loaded: [...loaded].sort(),
    lcov: records.length === 0 ? "" : `${records.join("\n")}\n`,
  };
}

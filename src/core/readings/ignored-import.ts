// An import into a path the config ignores is an error, never a missing edge.
export function ignoredImport(from: string, to: string): Error {
  return new Error(
    `${from} imports ${to}, which the config ignores; an ignored path must hold no importable source.`,
  );
}

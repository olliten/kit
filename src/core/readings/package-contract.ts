import type { KitConfig } from "../primitives/default-config.js";

type PackageContract = NonNullable<KitConfig["packages"]>[number];

// A literal public entry keeps its own contract; other imports retain the package root's contract.
export function packageContract(
  specifier: string,
  packages: readonly PackageContract[] | undefined,
): { readonly root: string | undefined; readonly declaration: PackageContract | undefined } {
  const root = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  const declaration = /^[.#/]/.test(specifier)
    ? undefined
    : packages?.find((row) => row.name === specifier) ?? packages?.find((row) => row.name === root);
  return { root, declaration };
}

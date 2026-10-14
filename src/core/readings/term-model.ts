import type { Snapshot } from "../primitives/snapshot.js";
import type { SpecTerm } from "../primitives/term.js";
import { type Finding, byDebtKey, finding } from "./finding.js";
import { placementOf } from "./placement-of.js";

export function termModel(snapshot: Snapshot): {
  readonly findings: readonly Finding[];
  readonly limits: readonly Finding[];
} {
  const findings: Finding[] = (snapshot.termSyntax ?? []).map(({ term, line, detail }) =>
    finding("R3", "term-declaration", term, detail, String(line)),
  );
  const limits: Finding[] = [];
  const repositorySources = new Set(
    snapshot.files
      .filter((file) => file.type === "source" || file.type === "test")
      .map((file) => file.path),
  );
  const identity = (name: string): string => name.toLowerCase().trim().replace(/\s+/g, " ");
  const terms = new Map<string, SpecTerm[]>();
  for (const term of snapshot.terms)
    terms.set(identity(term.term), [...(terms.get(identity(term.term)) ?? []), term]);
  const homes = new Map<string, string>();
  const candidateHomes = new Set<string>();
  const roles = {
    fact: "primitives",
    derived: "readings",
    adapter: "adapters",
    composition: "compositions",
  };
  for (const term of snapshot.terms) {
    if (term.metadata?.kind !== "module") continue;
    const metadata = term.metadata;
    const name = identity(term.term);
    const basename = name.replaceAll(" ", "-");
    const matches = snapshot.files.filter((file) => {
      const place = placementOf(file.path, snapshot.config.srcRoot);
      return (
        file.type === "source" &&
        place.placed &&
        place.zone === metadata.zone &&
        place.layer === roles[metadata.role] &&
        (place.name === basename ||
          snapshot.config.plurals.some((suffix) => place.name === basename + suffix))
      );
    });
    for (const match of matches) candidateHomes.add(match.path);
    if (matches.length !== 1 || (terms.get(name)?.length ?? 0) !== 1) {
      findings.push(
        finding(
          "R3",
          "term-home",
          term.term,
          "Resolve this module term to exactly one source home.",
          String(matches.length),
        ),
      );
      continue;
    }
    const file = matches[0];
    if (!file) continue;
    homes.set(name, file.path);
  }
  const ambiguousHomes = new Set<string>();
  const owners = new Map<string, string[]>();
  for (const [term, home] of homes) owners.set(home, [...(owners.get(home) ?? []), term]);
  for (const [home, terms] of owners) {
    if (terms.length < 2) continue;
    ambiguousHomes.add(home);
    findings.push(
      finding(
        "R3",
        "term-home",
        home,
        "Give each declared module concept its own source home.",
        "multiple-terms",
      ),
    );
  }
  for (const file of snapshot.files) {
    if (
      file.type !== "source" ||
      !placementOf(file.path, snapshot.config.srcRoot).placed ||
      owners.has(file.path) ||
      candidateHomes.has(file.path)
    )
      continue;
    findings.push(
      finding(
        "R3",
        "term-module",
        file.path,
        "Declare one module term for this placed source home.",
        "missing-owner",
      ),
    );
  }
  const projects = snapshot.compiler?.projects ?? [];
  const sources = projects.flatMap((project) => project.termFacts?.sources ?? []);
  const schemas = projects.flatMap((project) => project.termFacts?.types ?? []);
  const fieldOwner = (term: SpecTerm): string | undefined =>
    term.metadata?.kind === "field" ? homes.get(identity(term.metadata.typeOwner)) : undefined;
  for (const term of snapshot.terms) {
    const metadata = term.metadata;
    if (!metadata) continue;
    if (metadata.kind === "module") {
      const home = homes.get(identity(term.term));
      if (!home || ambiguousHomes.has(home)) continue;
      const allowed = new Set<string>();
      for (const path of metadata.legacySources ?? []) {
        const source = snapshot.files.find((file) => file.path === path && file.type === "source");
        if (!source || placementOf(path, snapshot.config.srcRoot).placed) {
          findings.push(
            finding(
              "R3",
              "term-legacy-source",
              home,
              "Name an existing unplaced source by path; use its global term once placed.",
              path,
            ),
          );
        } else allowed.add(path);
      }
      for (const reference of metadata.references) {
        const resolved = terms.get(identity(reference));
        if (resolved?.length !== 1) {
          findings.push(
            finding(
              "R3",
              "term-reference",
              home,
              "Resolve the declared source or part to one global term.",
              reference,
            ),
          );
          continue;
        }
        const target = resolved[0];
        if (!target) continue;
        const targetHome =
          homes.get(identity(reference)) ??
          (metadata.role === "fact" ? fieldOwner(target) : undefined);
        if (targetHome) allowed.add(targetHome);
      }
      const imports =
        projects.length > 0
          ? projects
              .flatMap((project) => project.imports)
              .filter(
                (edge) =>
                  edge.file === home && edge.target !== null && repositorySources.has(edge.target),
              )
              .map((edge) => edge.target)
          : snapshot.imports
              .filter((edge) => edge.from === home && repositorySources.has(edge.to))
              .map((edge) => edge.to);
      for (const imported of new Set(imports)) {
        if (imported !== home && imported !== null && !allowed.has(imported))
          findings.push(
            finding(
              "R3",
              "term-source",
              home,
              "Declare this actual imported owner in From or Of.",
              imported,
            ),
          );
      }
      for (const path of metadata.legacySources ?? []) {
        if (allowed.has(path) && !imports.includes(path))
          findings.push(
            finding(
              "R3",
              "term-legacy-source",
              home,
              "Name the actual imported legacy source, not another repository file.",
              path,
            ),
          );
      }
      if (metadata.role === "fact") {
        const evidence = sources.filter((source) => source.file === home);
        if (evidence.length === 0)
          limits.push(
            finding(
              "R3",
              "term-evidence",
              home,
              "Extract source declaration facts before checking the fact role.",
            ),
          );
        else if (evidence.some((source) => !source.factOnly))
          findings.push(
            finding(
              "R3",
              "term-fact",
              home,
              "Keep types and literal data in the fact; put executable derivation in a reading.",
            ),
          );
      }
    } else if (metadata.kind === "field") {
      const home = homes.get(identity(metadata.owner));
      const typeHome = homes.get(identity(metadata.typeOwner));
      if ((home && ambiguousHomes.has(home)) || (typeHome && ambiguousHomes.has(typeHome)))
        continue;
      if (!home || !typeHome) {
        findings.push(
          finding(
            "R3",
            "term-field",
            term.term,
            "Resolve both field and named type owners to declared modules.",
          ),
        );
        continue;
      }
      const schema = schemas.find(
        (schema) => schema.file === home && schema.name === metadata.declaration,
      );
      const property = schema?.properties.find((property) => property.name === metadata.property);
      if (!sources.some((source) => source.file === home))
        limits.push(
          finding(
            "R3",
            "term-evidence",
            home,
            "Extract named schema properties before checking this field.",
            term.term,
          ),
        );
      else if (!property)
        findings.push(
          finding(
            "R3",
            "term-field",
            home,
            "Bind the field to an existing named schema slot.",
            term.term,
          ),
        );
      else if (property.unsupported)
        limits.push(
          finding(
            "R3",
            "term-type-limit",
            home,
            "Review this unsupported field annotation before claiming its type identity.",
            term.term,
          ),
        );
      else if (
        property.other ||
        property.types.length !== 1 ||
        property.types[0]?.file !== typeHome ||
        property.types[0].name !== metadata.typeName ||
        property.absence.length !== metadata.absence.length ||
        property.absence.some((absence) => !metadata.absence.includes(absence))
      )
        findings.push(
          finding(
            "R3",
            "term-field",
            home,
            "Use the declared named type owner and permitted absence for this slot.",
            term.term,
          ),
        );
    }
  }
  const unique = (items: Finding[]): Finding[] =>
    [...new Map(items.map((item) => [item.debtKey, item])).values()].sort(byDebtKey);
  return { findings: unique(findings), limits: unique(limits) };
}

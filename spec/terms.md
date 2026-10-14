# Terms

## Primitive contracts

- **claim** — a promise declared once in its topic and proved by tests.
  - Role: fact
  - Zone: core
  - Of: []
- **comment** — supplied implementation text and its source location; it explains choices that other artifacts do not express.
  - Role: fact
  - Zone: core
  - Of: []
- **compiler-facts** — plain compiler observations about projects, settings, types, imports and authority entries supplied to the checks.
  - Role: fact
  - Zone: core
  - Of: []
- **default-config** — the target layout, as the config an app starts from.
  - Role: fact
  - Zone: core
  - Of: []
- **exported-symbol** — a supplied exported name and its declaring file.
  - Role: fact
  - Zone: core
  - Of: []
- **file** — a supplied file in a snapshot, identified by its path.
  - Role: fact
  - Zone: core
  - Of: []
- **import** — a supplied relation from an importing file to the file it imports.
  - Role: fact
  - Zone: core
  - Of: []
- **layer** — a declared dependency position and its permitted import relationships.
  - Role: fact
  - Zone: core
  - Of: []
- **module** — one named contract, identified as `<zone>/<layer>/<name>`.
  - Role: fact
  - Zone: core
  - Of: []
- **reference** — a marked use that points to the home of a term, topic or claim.
  - Role: fact
  - Zone: core
  - Of: []
- **snapshot** — the supplied files, declarations, configuration and compiler facts of one codebase.
  - Role: fact
  - Zone: core
  - Of: {{claim}}, {{comment}}, {{compiler-facts}}, {{default-config}}, {{exported-symbol}}, {{file}}, {{import}}, {{module}}, {{reference}}, {{term}}
- **term** — a concept defined once in the global terms file, with its meaning and any declared contract metadata.
  - Role: fact
  - Zone: core
  - Of: []
- **topic** — the unit the maintainer ratifies and the agent works from; it explains why its modules exist and how they compose.
  - Role: fact
  - Zone: core
  - Of: []
- **zone** — what code may do: core, shell or substrate.
  - Role: fact
  - Zone: core
  - Of: []

## Reading contracts

- **capability-check** — capability requirements, structural findings and explicit limits derived from supplied compiler and configuration facts.
  - Role: derived
  - Zone: core
  - From: {{dependency-check}}, {{finding}}, {{layer}}, {{snapshot}}
- **claim-inventory** — claim declarations and references interpreted from supplied Markdown.
  - Role: derived
  - Zone: core
  - From: {{claim}}
- **claim-proof-binder** — findings from matching claim declarations and topic-first test names, with the proof-path interpretation they share.
  - Role: derived
  - Zone: core
  - From: {{snapshot}}, {{finding}}
- **comment-check** — the check that comments cite nothing and carry no debt.
  - Role: derived
  - Zone: core
  - From: {{zone}}, {{claim-proof-binder}}, {{finding}}, {{placement-of}}, {{layer}}, {{snapshot}}
- **dependency-check** — the check that imports follow permitted layers and point inward across zones.
  - Role: derived
  - Zone: core
  - From: {{finding}}, {{placement-of}}, {{snapshot}}
- **finding** — what a check reports: its rule, a path, the fix and a debt key.
  - Role: derived
  - Zone: core
  - From: []
- **module-binder** — findings from matching declared module headings to their source files.
  - Role: derived
  - Zone: core
  - From: {{snapshot}}, {{finding}}, {{placement-of}}
- **name-check** — the check of unique global term definitions and retired words in names, prose and comments.
  - Role: derived
  - Zone: core
  - From: {{claim-proof-binder}}, {{finding}}, {{placement-of}}, {{snapshot}}
- **placement-of** — the interpretation of a supplied source path and root as declared placement or legacy code.
  - Role: derived
  - Zone: core
  - From: {{layer}}, {{zone}}
- **semantic-references** — marked topic and term references, their resolved homes, incoming topic relationships and nonexclusive module groups.
  - Role: derived
  - Zone: core
  - From: {{reference}}, {{topic}}, {{finding}}, {{snapshot}}
- **term-inventory** — global term definitions and inline declarations interpreted from supplied Markdown, with retained prose and syntax findings.
  - Role: derived
  - Zone: core
  - From: {{term}}
- **term-model** — findings and explicit limits from comparing declared roles, direct dependencies and selected named field types with source evidence.
  - Role: derived
  - Zone: core
  - From: {{snapshot}}, {{term}}, {{finding}}, {{placement-of}}

## Adapter contracts

- **compiler** — access to project loading and import resolution through a language compiler.
  - Role: adapter
  - Zone: substrate
  - Of: []
- **filesystem** — access to file text and directory entries.
  - Role: adapter
  - Zone: substrate
  - Of: []

## Composition contracts

- **read-snapshot** — the workflow that acquires codebase and compiler facts, connects their interpretations and assembles one snapshot.
  - Role: composition
  - Zone: substrate
  - Of: {{comment}}, {{compiler-facts}}, {{default-config}}, {{exported-symbol}}, {{file}}, {{import}}, {{module}}, {{snapshot}}, {{term}}, {{claim-inventory}}, {{semantic-references}}, {{term-inventory}}, {{compiler}}, {{filesystem}}

## Supporting vocabulary and roles

- **core** — the zone that decides everything and performs no effect.
- **public** — importable from another zone under the inward dependency rule.
- **placement** — a module's declared zone, layer and name.
- **placed** — at `<zone>/<layer>/<name>`, and so held to the placement rules.
- **legacy** — a source file that is not placed.
- **spec** — the prose the maintainer ratifies.
- **heading** — the spec line that carries a module's identity.
- **prose** — any text of the spec.
- **read** — to take a snapshot of a codebase.
- **file-type** — what a file is: source, test, spec or other.
- **import-edge** — one file's import of another.
- **kit** — the checks, their spec and their config, applied to an app.
- **maintainer** — the person who ratifies the spec and approves each change to the kit.
- **config** — what an app declares to the kit.
- **rule** — one of R1–R4; every check serves one.
- **debt-key** — a finding's stable name, which a debt list holds.
- **capability** — access to an operation a module may perform.
- **check** — a reading that reports findings for a rule.
- **result** — the value returned by a reading or composition.
- **cycle** — a dependency path that returns to its starting module.
- **workspace** — the project files and settings a compiler loads.
- **proof** — a test that establishes a claim.
- **inventory** — the collected declarations and references read from a document.
- **marker** — the notation identifying a declaration or reference.
- **semantic** — identifying a defined meaning rather than matching an ordinary word.
- **resolved** — matched to exactly one existing home in the intended namespace.

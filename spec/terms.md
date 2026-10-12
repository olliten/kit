# terms — the kit's language

## Model
- **zone** — what code may do: core, shell or substrate.
- **core** — the zone that decides everything and performs no effect.
- **public** — importable from another zone under the inward dependency rule.
- **placement** — a module's declared zone, layer and name.
- **placed** — at `<zone>/<layer>/<name>`, and so held to the placement rules.
- **legacy** — a source file that is not placed.

## Spec
- **spec** — the prose the owner ratifies.
- **heading** — the spec line that carries a module's identity.
- **prose** — any text of the spec.
- **term** — a word of the app's language, defined once in the terms file.

## Snapshot
- **snapshot** — one read of a codebase: its files, imports, headings, terms, symbols and prose.
- **read** — to take a snapshot of a codebase.
- **file** — a path in a snapshot.
- **file-type** — what a file is: source, test, spec or other.
- **import-edge** — one file's import of another.
- **exported-symbol** — a name a source file exports.

## Checks
- **kit** — the checks, their spec and their config, applied to an app.
- **config** — what an app declares to the kit.
- **default-config** — the target layout, as the config an app starts from.
- **rule** — one of R1–R4; every check serves one.
- **finding** — what a check reports: its rule, a path, the fix and a debt key.
- **debt-key** — a finding's stable name, which a debt list holds.
- **binder** — the check that module headings bind to files and claim-first tests bind to topic claims.
- **dependency-check** — the check that imports point forward within a zone and inward across zones.
- **name-check** — the check that names use only terms and connectors.
- **comment** — text in a source or test file that the program ignores; it says why the implementation is built this way.
- **comment-check** — the check that comments cite nothing and carry no debt.

## Capabilities and claim structure
- **capability** — access to an operation a module may perform.
- **check** — a reading that reports findings for a rule.
- **result** — the value returned by a reading or composition.
- **cycle** — a dependency path that returns to its starting module.
- **layer** — primitives, readings or compositions, with dependencies pointing down or sideways.
- **claim** — a promise declared once in a topic and proved by tests.
- **proof** — a test that establishes a claim.
- **inventory** — the collected declarations and references read from a document.
- **marker** — the notation identifying a declaration or reference.
- **semantic** — identifying a defined meaning rather than matching an ordinary word.
- **reference** — a marked use that points to the home of a term, topic or claim.
- **resolved** — matched to exactly one existing home in the intended namespace.

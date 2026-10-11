# terms — the kit's language

## Model
- **zone** — what code may do: core, shell or substrate.
- **core** — the zone that decides everything and performs no effect.
- **kind** — a module's signature: data, state, reading, change or effect.
- **public** — importable from another zone: core data, readings and changes.
- **placed** — at `<zone>/<kind>/<name>`, and so held to the rules.
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
- **binder** — the check that a heading, a file and its tests name one module.
- **dependency-check** — the check that imports point forward within a zone and inward across zones.
- **name-check** — the check that names use only terms and connectors.

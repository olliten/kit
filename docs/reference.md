# Reference

What `kit/config.md` can declare beyond the basics in the README, and the portable tools Kit ships. The spec in
`spec/` says what holds; this page says how to ask for it.

## Claims as table rows

A claim may be a table row. Each data row is one claim, with its anchor closing the final cell:

```markdown
| Command | What it does | Available when |
| --- | --- | --- |
| Decline | Saves the reviewer's reason. | An article is open. · {#decline-needs-reason} |
```

All cells together state the claim and contribute their references. The same anchor binds the same proof file
whether the claim is a list item or a row. Optional `Implementation` and `Proof` columns hold comma-separated
module references; an empty cell omits that relationship. Headers declare no claims.

`Implementation` names modules providing the claimed behaviour; `Proof` names reusable machinery used to establish
it, such as shared generators, reference models or drivers. Each row appears at most once and lists distinct
references. The claim test is the outer proof entrypoint: it registers cases, wires modules and asserts results.

## Several code roots

To govern shared test modules too, list the code roots:

```yaml
roots:
  src: [src, oracle]
  spec: spec
  oracle: oracle
```

Each code root uses the same zones and layers. Module identities then include the root, for example
`oracle/core/primitives/decline-cases`, and adapter registrations use those identities. Term names stay globally
unique. `roots.oracle` still selects claim proof files.

## Adapters

```yaml
adapters:
  - module: substrate/adapters/journal
    export: journal
    capability: journal
    kind: external          # or produce / apply, for write descriptions
    zones: [substrate]
    contract: {type: Journal}
    globals: [fetch]        # host globals only this adapter may use
    packages: [some-sdk]    # packages only this adapter may import; their handles may be passed to it
    primitives: [clock]     # clock or randomness sampled here
```

The contract type and every port its operations return are the only behaviour the core and readings may take,
and only the adapter's file constructs their values.

## Entrypoints

An exact file outside every zone may wire Shell and Substrate contracts, such as an application's startup or a
claim test:

```yaml
exceptions:
  - oracle/review-an-article/decline-needs-reason.test.ts
```

It keeps its topic binding and is checked for authority and compiler failures. No module may import it, its
dependencies gain no permission, and its violations can't be waived as legacy debt. It may construct test
doubles of a contract. For direct test registration, a package contract can select named runtime exports:

```yaml
packages:
  - name: vitest
    capabilities: [test-runner]
    entrypointExports: [test, expect]
```

This is available only in exact declared entrypoints. Aliases and type-only imports are supported; namespace
imports, dynamic imports, re-exports and package subpaths stay unresolved. A package owned by an adapter still
belongs to that adapter.

## Dependency exclusions

```yaml
dependency-exclusions:
  - from: src
    to: oracle
    imports: all
    reach: direct
  - from: oracle/core/readings/reference.ts
    to: src/core/readings/actual.ts
    imports: runtime
    reach: transitive
```

Selectors name existing files or directories, without patterns. The first rule forbids direct production imports
of oracle code, including types. The second follows runtime dependencies through helpers and re-exports to keep a
reference model separate from the implementation it judges. Erased type contracts remain allowed. Transitive
checks retain uncertainty at opaque boundaries. Direct checks also use an ambient module's single declaration
home, such as Node built-in declarations; several homes retain uncertainty.

## Legacy

- `layout: {legacy: [...]}`: existing code outside the code roots, kept in extraction, authority and size
  accounting as location debt. Declaring a layout also checks that source, tests and specs sit in their roots.
- `legacy-zones`: the zone a legacy prefix, or an exact list of legacy files, actually belongs to, so imports
  across placement keep zone boundaries.
- `legacy-areas`: spec files in an older format, outside the topic shape until they gain Implementation rows.
- `legacy-test-roots`: test directories the runner should still discover; read by `testRoots()` in
  `scripts/kit-config.mjs`.

## Portable verification

`scripts/kit-verification.mjs` exports `verification()`, which loads the pure evidence planner and
duration-aware partitioner, and `runVerification(checks, io)`, which runs a dependency graph with supplied effects
and resource capacity. Checks declare stable identities, input fingerprints, execution contracts and required
strength; the caller supplies discovery, input tracking, evidence storage and policy.

For checks with declared filesystem inputs, `declaredInputFiles` in
`src/substrate/adapters/declared-input-files.ts` resolves files, suffix-filtered trees and path-kind probes into an
input key. It keys only declared inputs: it does not discover a check's reads or choose its cache policy.

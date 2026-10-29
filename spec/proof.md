# Proof

A topic states what one part of the product promises, as claims, and every claim has a test. The modules
a claim depends on are named in it, so each module's claims are found from its name.

## Topics

- A topic is a `# ` title, an intro of at most three sentences, then only `## ` sections and claims, presented
  as list items or Markdown table rows. A list claim may follow its closing paragraph with one unordered
  list of plain `Implementation:` and `Proof:` rows, each occurring at most once and containing a nonempty
  comma-separated list of distinct module references. Other nested blocks, a module heading or prose after
  the intro are findings. · {#topics-have-one-shape}
  - Implementation: {{topic-shape}}, {{claim-inventory}}, {{finding}}
  - Proof: {{fixture-snapshot}}

- Every placed module is named as `{{name}}` by at least one claim, in any topic; a module no claim names is
  a finding, and a module's claims are derived from those names, never written into the module. · {#modules-are-named-by-claims}
  - Implementation: {{module-references}}, {{claim-proof-binder}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}, {{binding-findings}}

## Claims

- A claim is a list item whose promise paragraph closes with its anchor, or a table data row whose final
  cell closes with its anchor. Either is declared once and proved by one or more tests at
  `oracle/<topic>/<anchor>.test.ts` or `oracle/<topic>/<anchor>.<variant>.test.ts`; a claim without a test,
  a repeated claim and a test that names no claim of its topic are findings ({{claim}},
  {{claim-inventory}}, {{claim-proof-binder}}). Implementation names modules providing the claimed
  behavior, and Proof names shared proof machinery; neither relationship assigns a code root, and both
  contribute to the same reference inventory. · {#claims-have-one-home}
  - Implementation: {{read-snapshot}}, {{module-references}}, {{finding}}
  - Proof: {{binding-findings}}
- A claim table has a header naming its fields and one claim per data row, with one cell for each header.
  Every row has exactly one closing anchor; its cells together state that claim. Headers and separators declare no claims, and cells
  are not separate claims. References and module names are read from every cell with the same rules as
  list claims. Moving a claim between the two presentations keeps its anchor, proof binding and reference
  relationships. A promise about row order or table completeness is a separate claim; layout alone declares
  neither. · {#table-rows-present-claims}
  - Implementation: {{topic-shape}}, {{claim-inventory}}, {{semantic-references}}, {{claim-proof-binder}}, {{module-references}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}, {{binding-findings}}
- A claim table may have at most one `Implementation` column and one `Proof` column. A nonempty cell in
  either holds the same nonempty comma-separated list of distinct module references as that list-claim
  annotation; an empty cell omits the relationship for that row. The row's closing anchor is not part of an
  annotation value. The two presentations give the same relationships to the same reference inventory.
  · {#table-annotations-keep-claim-relationships}
  - Implementation: {{topic-shape}}, {{claim-inventory}}, {{claim-proof-binder}}, {{module-references}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}, {{binding-findings}}
- In a configured legacy area, an anchored paragraph followed by explanatory bullets, or a
  `### law · id — explanation` heading, declares a claim; new topics keep the strict grammar
  ({{claim-inventory}}). A legacy claim with Implementation or Proof rows follows the same module-reference,
  claim-proof and proof-reach rules as a topic claim; other legacy claims remain outside those checks. · {#legacy-claims-keep-their-grammar}
  - Implementation: {{claim-proof-binder}}, {{proof-reach}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}, {{temporary-project}}, {{processes}}
- A claim's tests together reach every placed module the claim names through the code they use, followed
  into helpers and modules as a capture is, and the modules of only types that code is written in; a named
  module none of them reaches is a finding, so a claim's names are proved rather than trusted. · {#proofs-reach-named-modules}
  - Implementation: {{proof-reach}}, {{placement-of}}, {{read-snapshot}}, {{relative-import}}, {{test-reach}}
  - Proof: {{fixture-snapshot}}, {{recorded-reach}}
- A claim's tests reach only the placed modules it names, so its names are exactly what its proof uses. Only
  the modules of only types need no name: a placed oracle module, such as a generator, fixture, driver or
  runner, is named in the claim's Proof like any other, what it reaches counts as the test's, and naming a
  composition names what it composes. Naming a placed module under the proof root, whatever its layer, names
  what it reaches, since a Proof name is about the harness, not the design. A module a claim's tests reach without its name is
  debt: the baseline holds it, it may only shrink, and a new claim starts exact. · {#proofs-reach-only-named-modules}
  - Implementation: {{proof-scope}}, {{proof-reach}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}
- Two claims that share no code share no module. When the claims naming a placed module fall into groups
  whose tests use disjoint top-level declarations of it, the module is a finding: split it so each group has
  its own. A module of only types links no claims, and a module a test reaches in ways that can't be followed
  counts as used whole. · {#claims-that-share-no-code-share-no-module}
  - Implementation: {{claim-cohesion}}, {{proof-reach}}, {{placement-of}}, {{read-snapshot}}, {{test-reach}}
  - Proof: {{source-fixture}}

## Runs

- `kit verify`, given a test command that writes the test's LCOV report into `{dir}`, keeps with each test's pass
  the named functions of each placed module the test ran; raw V8 coverage adds the processes a test starts, where
  a function's reported name and line match the source. `kit check` reads them from each test's pass while it
  still holds. While a test under the proof root has none, the rules that read what tests ran wait, and the check
  says how many tests they wait for. A placed module no test ran is not missing: its functions are simply
  unrun. · {#runs-are-kept-with-each-pass}
  - Implementation: {{verify-run}}, {{check-run}}, {{held-state}}, {{coverage-report}}, {{test-runs}}, {{runs}}, {{verdict}}, {{verdict-reuse}}, {{evidence-store}}, {{filesystem}}, {{processes}}, {{text-files}}
  - Proof: {{temporary-project}}
- Every named function of a placed module is run by a test of a claim that names the module, so each piece of
  code is governed by a claim that promises something about it. A named function none of those claims runs is
  debt: proved only incidentally by another claim, or by none. A module of only types has no functions, and an
  anonymous function belongs to the named function that holds it. · {#every-function-is-governed}
  - Implementation: {{function-governance}}, {{claim-runs}}, {{function-recorder}}, {{finding}}, {{placement-of}}, {{proof-reach}}, {{fact-walk}}, {{compiler}}
  - Proof: {{recorded-functions}}, {{project-snapshot}}
- Claims that share a module share its code. A named function only one claim's tests run, and that no named
  function other claims run holds, is that claim's excerpt; a module that holds the excerpts of two or more
  claims is several modules, and each excerpt moves to its own. Code that every claim runs is the module's
  shared core and stays. An adapter is defined by its operations, so it is exempt. · {#claims-keep-their-excerpts-apart}
  - Implementation: {{excerpt-cohesion}}, {{claim-runs}}, {{function-recorder}}, {{finding}}, {{placement-of}}, {{proof-reach}}, {{fact-walk}}, {{compiler}}
  - Proof: {{recorded-functions}}, {{project-snapshot}}


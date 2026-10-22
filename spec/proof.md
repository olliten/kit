# Proof

A topic states what one part of the product promises, as claims, and every claim has a test. The modules
a claim depends on are named in it, so each module's claims are found from its name.

## Topics

- A topic is a `# ` title, an intro of at most three sentences, then only `## ` sections and claims, presented
  as list items or Markdown table rows. A list claim may follow its closing paragraph with one unordered
  list of plain `Implementation:` and `Proof:` rows, each occurring at most once and containing a nonempty
  comma-separated list of distinct module references. Other nested blocks, a module heading or prose after
  the intro are findings. · {#topics-have-one-shape}
  - Implementation: {{topic-shape}}
  - Proof: {{fixture-snapshot}}

- Every placed module is named as `{{name}}` by at least one claim, in any topic; a module no claim names is
  a finding, and a module's claims are derived from those names, never written into the module. · {#modules-are-named-by-claims}
  - Implementation: {{module-references}}
  - Proof: {{fixture-snapshot}}, {{binding-findings}}

## Claims

- A claim is a list item whose promise paragraph closes with its anchor, or a table data row whose final
  cell closes with its anchor. Either is declared once and proved by one or more tests at
  `oracle/<topic>/<anchor>.test.ts` or `oracle/<topic>/<anchor>.<variant>.test.ts`; a claim without a test,
  a repeated claim and a test that names no claim of its topic are findings ({{claim}},
  {{claim-inventory}}, {{claim-proof-binder}}). Implementation names modules providing the claimed
  behavior, and Proof names shared proof machinery; neither relationship assigns a code root, and both
  contribute to the same reference inventory. · {#claims-have-one-home}
  - Proof: {{binding-findings}}
- A claim table has a header naming its fields and one claim per data row, with one cell for each header.
  Every row has exactly one closing anchor; its cells together state that claim. Headers and separators declare no claims, and cells
  are not separate claims. References and module names are read from every cell with the same rules as
  list claims. Moving a claim between the two presentations keeps its anchor, proof binding and reference
  relationships. A promise about row order or table completeness is a separate claim; layout alone declares
  neither. · {#table-rows-present-claims}
  - Implementation: {{topic-shape}}, {{claim-inventory}}
  - Proof: {{fixture-snapshot}}, {{binding-findings}}
- A claim table may have at most one `Implementation` column and one `Proof` column. A nonempty cell in
  either holds the same nonempty comma-separated list of distinct module references as that list-claim
  annotation; an empty cell omits the relationship for that row. The row's closing anchor is not part of an
  annotation value. The two presentations give the same relationships to the same reference inventory.
  · {#table-annotations-keep-claim-relationships}
  - Implementation: {{topic-shape}}, {{claim-inventory}}
  - Proof: {{fixture-snapshot}}, {{binding-findings}}
- In a configured legacy area, an anchored paragraph followed by explanatory bullets, or a
  `### law · id — explanation` heading, declares a claim; new topics keep the strict grammar
  ({{claim-inventory}}). A legacy claim with Implementation or Proof rows follows the same module-reference,
  claim-proof and proof-reach rules as a topic claim; other legacy claims remain outside those checks. · {#legacy-claims-keep-their-grammar}
- A claim's tests together reach every placed module the claim names through the code they use, followed
  into helpers and modules as a capture is, and the modules of only types that code is written in; a named
  module none of them reaches is a finding, so a claim's names are proved rather than trusted. · {#proofs-reach-named-modules}
  - Implementation: {{proof-reach}}, {{claim-proof-binder}}, {{read-snapshot}}
  - Proof: {{fixture-snapshot}}

## Changes

- Given a base, `kit check --base <ref>` also checks what the change did since it left that ref. A claim's
  test it edited is a finding unless the claim's topic changed too, or a commit says why in a line
  `Test fix: <test path>: <reason>`. An added or deleted test, and a shared proof module, change no promise.
  · {#tests-change-with-their-topic}
  - Implementation: {{test-change-check}}, {{change-log}}, {{change-history}}
  - Proof: {{fixture-snapshot}}, {{temporary-repository}}

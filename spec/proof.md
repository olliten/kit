# Proof

A topic states what one part of the product promises, as claims, and every claim has a test. The modules
a claim depends on are named in it, so each module's claims are found from its name.

## Topics

- A topic is a `# ` title, an intro of at most three sentences, then only `## ` sections and claims; a
  claim may follow its closing paragraph with one unordered list of plain `Implementation:` and `Proof:`
  rows, each occurring at most once and containing a nonempty comma-separated list of distinct module
  references. Other nested blocks, a module heading or prose after the intro are findings. · {#topics-have-one-shape}
  - Implementation: {{topic-shape}}
  - Proof: {{fixture-snapshot}}

- Every placed module is named as `{{name}}` by at least one claim, in any topic; a module no claim names is
  a finding, and a module's claims are derived from those names, never written into the module. · {#modules-are-named-by-claims}
  - Implementation: {{module-references}}
  - Proof: {{fixture-snapshot}}, {{binding-findings}}

## Claims

- A claim is a list item whose promise paragraph closes with its anchor, declared once and proved by
  one or more tests at
  `oracle/<topic>/<anchor>.test.ts` or `oracle/<topic>/<anchor>.<variant>.test.ts`; a claim without a test,
  a repeated claim and a test that names no claim of its topic are findings ({{claim}},
  {{claim-inventory}}, {{claim-proof-binder}}). Implementation names modules providing the claimed
  behavior, and Proof names shared proof machinery; neither relationship assigns a code root, and both
  contribute to the same reference inventory. · {#claims-have-one-home}
  - Proof: {{binding-findings}}
- In a configured legacy area, an anchored paragraph followed by explanatory bullets, or a
  `### law · id — explanation` heading, declares a claim; new topics keep the strict grammar
  ({{claim-inventory}}). A legacy claim with Implementation or Proof rows follows the same module-reference,
  claim-proof and proof-reach rules as a topic claim; other legacy claims remain outside those checks. · {#legacy-claims-keep-their-grammar}
- A claim's tests together reach every placed module the claim names through the code they use, followed
  into helpers and modules as a capture is, and the modules of only types that code is written in; a named
  module none of them reaches is a finding, so a claim's names are proved rather than trusted. · {#proofs-reach-named-modules}
  - Implementation: {{proof-reach}}, {{claim-proof-binder}}, {{read-snapshot}}
  - Proof: {{fixture-snapshot}}

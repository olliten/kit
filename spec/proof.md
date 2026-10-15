# Proof

A topic states what one part of the product promises, as claims, and every claim has a test. The modules
a claim depends on are named in it, so each module's claims are found from its name.

## Topics

- A topic is a `# ` title, an intro of at most three sentences, then only `## ` sections and claims; a
  module heading, prose after the intro or any other block is a finding ({{topic-shape}}). · {#topics-have-one-shape}
- Every placed module is named as `{{name}}` by at least one claim, in any topic; a module no claim names is
  a finding, and a module's claims are derived from those names, never written into the module
  ({{module-references}}). · {#modules-are-named-by-claims}

## Claims

- A claim is a list item closed by its anchor, declared once, and proved by one or more tests at
  `oracle/<topic>/<anchor>.test.ts` or `oracle/<topic>/<anchor>.<variant>.test.ts`; a claim without a test,
  a repeated claim and a test that names no claim of its topic are findings ({{claim}},
  {{claim-inventory}}, {{claim-proof-binder}}). · {#claims-have-one-home}
- In a configured legacy area, an anchored paragraph followed by explanatory bullets, or a
  `### law · id — explanation` heading, declares a claim; new topics keep the strict grammar
  ({{claim-inventory}}). · {#legacy-claims-keep-their-grammar}

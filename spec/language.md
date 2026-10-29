# Language

Every word the code and the spec use for a module is a term, defined once in the terms file with its role
and zone. Topics and claims refer to terms as `{{term}}` and to topics as `[[topic]]`. Comments say only
why the code is built the way it is.

## Terms

- A term is defined once; case and repeated spaces don't make a second definition, and punctuation does. · {#terms-are-defined-once}
  - Implementation: {{name-check}}, {{term-inventory}}, {{term}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}

- Each list in the terms file is in alphabetical order, so agents adding different terms edit different
  lines. · {#terms-are-alphabetical}
  - Implementation: {{term-inventory}}, {{term-order}}, {{finding}}
  - Proof: {{fixture-snapshot}}

- An app without its configured terms file has a finding naming that file; an empty terms file is enough. · {#terms-file-is-required}
  - Implementation: {{term-model}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}

- A retired word in a name, an exported symbol, spec prose or a placed file's comment is a finding whose fix
  names the term that replaced it. · {#retired-words-are-findings}
  - Implementation: {{name-check}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}

## Modules

- A module's whole name is a term with its role and zone; known words inside the name don't declare a
  missing term, and a declared plural applies to the whole name. · {#modules-are-whole-terms}
  - Implementation: {{term-model}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}

- A placed module and its term bind both ways, and the term's From and Of name the module's actual direct
  owners; a supporting type or a selected field creates no other module, and a term grants no authority. · {#modules-bind-to-terms}
  - Implementation: {{term-model}}, {{exported-symbol}}, {{term-recorder}}, {{term-inventory}}, {{import-recorder}}, {{authority-recorder}},
    {{fact-walk}}, {{behaviour-reading}}, {{contract-reading}}, {{native-reading}}, {{compiler}}, {{capability-check}}
  - Proof: {{fixture-snapshot}}, {{recorded-terms}}, {{recorded-imports}}, {{recorded-authority}}, {{project-snapshot}}

- A supporting exported type needs no term for its ordinary words, and a retired word in it is still a
  finding. · {#supporting-symbols-need-no-terms}
  - Implementation: {{name-check}}, {{exported-symbol}}, {{term-model}}, {{read-snapshot}}, {{kit-configuration}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}

## References

- `[[topic]]` and `{{term}}` each resolve to exactly one target in their own namespace; a missing or
  ambiguous target is a finding, and code, inline code and escaped examples are not references
  ({{semantic-references}}, {{reference}}, {{topic}}). · {#references-resolve}
  - Implementation: {{term-inventory}}, {{claim-inventory}}, {{module-references}}, {{claim-proof-binder}}, {{dependency-check}}, {{finding}},
    {{placement-of}}
  - Proof: {{binding-findings}}
- Claims in several topics may name one module, and regrouping topics changes no import permission or
  source binding. · {#topics-share-modules}
  - Implementation: {{capability-check}}, {{semantic-references}}, {{term-inventory}}, {{term-model}}, {{module-references}}, {{claim-proof-binder}}
  - Proof: {{fixture-snapshot}}, {{binding-findings}}

## Comments

- A comment that says why is free; one that cites a claim anchor, a Markdown file or a module identity is a
  finding whose fix says what to delete. · {#comments-cite-nothing}
  - Implementation: {{comment-check}}, {{comment}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}

- A debt marker in a comment, as a whole word in capitals, is a finding whose fix moves it to a debt list. · {#comments-carry-no-debt}
  - Implementation: {{comment-check}}, {{finding}}, {{placement-of}}
  - Proof: {{fixture-snapshot}}

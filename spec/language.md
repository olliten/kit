# Language

Every word the code and the spec use for a module is a term, defined once in the terms file with its role
and zone. Topics and claims refer to terms as `{{term}}` and to topics as `[[topic]]`. Comments say only
why the code is built the way it is.

## Terms

- A term is defined once; case and repeated spaces don't make a second definition, and punctuation does
  ({{name-check}}, {{term-inventory}}, {{term}}). · {#terms-are-defined-once}
- Each list in the terms file is in alphabetical order, so agents adding different terms edit different
  lines ({{term-inventory}}, {{term-model}}). · {#terms-are-alphabetical}
- An app without its configured terms file has a finding naming that file; an empty terms file is enough
  ({{name-check}}). · {#terms-file-is-required}
- A retired word in a name, an exported symbol, spec prose or a placed file's comment is a finding whose fix
  names the term that replaced it ({{name-check}}). · {#retired-words-are-findings}

## Modules

- A module's whole name is a term with its role and zone; known words inside the name don't declare a
  missing term, and a declared plural applies to the whole name ({{term-model}}). · {#modules-are-whole-terms}
- A placed module and its term bind both ways, and the term's From and Of name the module's actual direct
  owners; a supporting type or a selected field creates no other module ({{term-model}},
  {{exported-symbol}}). · {#modules-bind-to-terms}
- A supporting exported type needs no term for its ordinary words, and a retired word in it is still a
  finding ({{name-check}}, {{exported-symbol}}). · {#supporting-symbols-need-no-terms}

## References

- `[[topic]]` and `{{term}}` each resolve to exactly one target in their own namespace; a missing or
  ambiguous target is a finding, and code, inline code and escaped examples are not references
  ({{semantic-references}}, {{reference}}, {{topic}}). · {#references-resolve}
- Claims in several topics may name one module, and regrouping topics changes no import permission or
  source binding ({{semantic-references}}). · {#topics-share-modules}

## Comments

- A comment that says why is free; one that cites a claim anchor, a Markdown file or a module identity is a
  finding whose fix says what to delete ({{comment-check}}, {{comment}}). · {#comments-cite-nothing}
- A debt marker in a comment, as a whole word in capitals, is a finding whose fix moves it to a debt list
  ({{comment-check}}). · {#comments-carry-no-debt}

# Language

Global declarations support [[code-structure]] and [[proof]] without owning their permissions.

### R3: binding and one home for meaning

A module's source identity is `<zone>/<layer>/<name>`, in kebab-case, and resolves to its global term.
A topic may reference that module through its term or a heading with the same identity. References do
not declare another module. Layers state dependency position, not claim ownership. Renames move
identities and references together.

Terms are defined once. A module's whole concept name resolves to one global term
with the matching role and zone. Compounds resolve as whole identities; declared
plural inflection applies to the concept name. Splitting a name into known words
does not establish its concept. Duplicate definitions, missing concept owners and
retired words are findings.

Supporting exported symbols need no glossary entries for their ordinary words;
their names remain subject to retired-word scanning. Properties and private
helpers introduce no terms merely through their spelling. A supporting type may
be exported by its concept's module without becoming another module term.
Existing retired-word restrictions on scanned names, prose and comments remain.

Write `[[Topic]]` to reference a topic and `{{term}}` to reference a term. Each resolves to exactly one home
in its own namespace. A topic's identity is its filename within the configured spec root, without the
extension; case does not distinguish identities. A term's identity is its defined name; case and repeated
whitespace do not distinguish identities. Punctuation remains significant, and titles introduce no aliases.
Missing or ambiguous targets are findings. Code blocks, inline code and escaped examples are ignored.
The checker does not infer semantic references from unmarked ordinary words.

Incoming topic references and nonexclusive module groups are derived alongside claim ownership and proof locations. Moving a claim's
topic preserves its anchor and updates its references and proof location together. Topic regrouping never
changes code import permissions. No separate registry of these relationships is maintained.

Meaning lives in terms, purpose in topics, guarantees in claims, shape in types,
proof in tests and debt in the ledger. Comments explain implementation choices none
of those express. They cite nothing, carry no debt markers and restate no claims.
A suspected restatement is reviewed by a person.

A roster is the table or fenced list under its module heading. The module's value
equals it entry for entry. Reference rendering belongs to the contracts that
promise it, not to every schema or constant.

## Global declarations

The global {{term}} definition states one meaning. Inline metadata states a module
role and {{zone}}, declared From or Of owners, or a selected field/type binding.
Role determines the layer: fact, derived, adapter or composition. Compositions may
assemble workflows in any permitted zone; an act or surface describes their purpose.

From and Of include actual direct local type-only and runtime owners. Supported
external operations retain their explicit package and {{capability}} evidence. A
missing owner or unsupported pattern remains a finding or explicit limit.

From and Of name global module terms for placed dependencies. During migration,
they may also name an existing unplaced source by its repository path. That path
must resolve to the actual imported source. A placed dependency must use its global
term, never this legacy path form. Declaring a dependency changes no zone, layer,
capability or cycle permission.

Supporting types belong with their concepts. Field roles create no extra module;
private helpers create no extra term. Raw draft and encoded representations remain
distinct from accepted domain data. No declaration supplies an invented schema value.

Definitions and code-derived owner/type evidence use the same snapshot for Kit and
app. The declared term graph does not prove semantic cohesion, narrowness or behavior.
Unclassified genuine concepts are not silently treated as plain words.

## Contracts

### core/primitives/term

Keep declarations and syntax observations separate from their structural interpretation. Uses {{term}}.

### core/primitives/topic

Carry actual file/name identities without inventing a duplicate topic-prose schema. Uses {{topic}}.

### core/primitives/reference

Keep supplied topic and term marks separate from their resolved targets. Located claim marks use {{claim}} supporting shapes; these representations need no unused universal tagged union. Uses {{reference}}.

### core/primitives/comment

Supply implementation text and locations without judging its purpose during acquisition. Uses {{comment}}.

### core/primitives/exported-symbol

Let name checks use declared exports without acquiring compiler authority. Uses {{exported-symbol}}.

### core/readings/name-check

Check unique global definitions and retired names; concept-to-module identity is checked with the declared structural metadata. Uses {{name-check}}.

### core/readings/comment-check

Check comment restrictions independently of domain decisions. Uses {{comment-check}}.

### core/readings/term-inventory

Read one Markdown declaration grammar for all consumers. Uses {{term-inventory}}.

### core/readings/term-model

Compare declarations with supplied source evidence without treating structural agreement as semantic proof. Uses {{term-model}}.

### core/readings/semantic-references

Resolve marked uses once and derive nonexclusive module groups without a membership registry. Uses {{semantic-references}}.

## Proof obligations

- Marked references resolve in their own namespaces and expose topic-refactoring impact without changing
  claim identities or import permissions. · {#semantic-references-resolve}
- a debt marker in a comment is a finding whose fix moves it to a debt list. · {#comment-check-carries-no-debt}
- a comment that says why the code is built this way is free. · {#comment-check-cites-nothing}
- the kit. · {#comment-check-self-hosted}
- Whole module concept identities resolve to their declared terms with matching
  roles and zones; known word fragments do not establish a missing concept
  declaration. · {#name-check-built-from-terms}
- A supporting exported type such as TermSyntaxIssue needs no separate syntax or
  issue term, while a retired word in that symbol remains a finding. · {#name-check-supporting-symbols}
- A declared module concept and its source identity bind in both directions within
  the adopted source scope; a selected field role or supporting type creates no
  additional module. · {#module-concept-binding}
- a term defined once has no finding. · {#name-check-defined-once}
- a retired word in a name is a finding, and its fix names the term that replaced it. · {#name-check-retired-words}
- the kit. · {#name-check-self-hosted}

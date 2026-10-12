# Rules

## Rules

### R1: zones and capabilities

A module's capabilities must be permitted by its zone. Readings perform no external
effect, produce no writes and apply no writes.

The language adapter checks supported primitive access. Raw operations occur only
in their adapters. Reading the clock differs from converting a supplied timestamp.
Aliases and re-exports retain the supplying module's capabilities.

Authority enters through ambient globals, runtime imports and parameters whose
contracts grant it. Readings accept data contracts. Calls do not introduce an
additional capability; they use the capabilities of their inputs and implementation.
The adapter checks executable members and accessors visible in a reading's parameter
type. It does not prove that an arbitrary runtime object is free of getters or proxies.

Capabilities propagate through legacy modules without assigning them a layer. An
unknown external package produces a finding at its import. One package declaration
in the configuration states its capabilities. An unsupported authority entry remains
an explicit checker limit, never evidence of purity. Ordinary calls and arbitrary
data provenance do not produce separate uncertainty findings.

Each zone compiles against only the APIs it may touch. Loosening its required
compiler settings is a finding. Exports state their types.
Domain values use their term's type unless the term is declared plain. Compared
fixed literals have union types. Untyped values, non-const type assertions and suppressed
type errors are findings. A non-null assertion directly on an indexed access, such as
`items[i]!`, is permitted. Other non-null assertions are type escapes. Literal `as const`
preserves precision and is permitted.

A rule that the checker cannot establish is checked by a person. For example,
whether a shell module invents a domain decision needs review when the structure
alone cannot establish it. The finding states this limit.

### R2: dependencies and writes

Imports point down or sideways within a zone and inward across zones. Cycles are findings.

Code that neither produces nor applies writes never calls code that does. A visible
write-set construction outside a module with production capability is a finding.
Inspection and transport of an existing description do not produce writes.

Spreading an existing write set into a new one is a visible construction. A private
type brand does not exempt that construction from its production capability.

Private implementation mutation is not a domain-state write by itself. It must not
escape or alter the promised result. A memo equals the uncached reading. Behavior
the adapter cannot establish remains explicit rather than assumed harmless.

### R3: binding and one home for meaning

A module heading and its source file carry the same `<zone>/<layer>/<name>` identity,
in kebab-case. Layers state dependency position, not claim ownership. Renames move
identities and references together.

Terms are defined once. Names use terms and declared connectors. Compounds are terms
in their own right; plurals use the same term. Duplicate definitions, undefined
words in names and retired words are findings. Roster entries are terms too.

Meaning lives in terms, purpose in topics, guarantees in claims, shape in types,
proof in tests and debt in the ledger. Comments explain implementation choices none
of those express. They cite nothing, carry no debt markers and restate no claims.
A suspected restatement is reviewed by a person.

A roster is the table or fenced list under its module heading. The module's value
equals it entry for entry. Reference rendering belongs to the contracts that
promise it, not to every schema or constant.

### R4: proof

Every claim is named by one or more tests. Every law test names a claim or an
applicable structural obligation. Tests use public contracts; structural checks
may inspect the facts they establish.

A claim test lives under the configured oracle root, in the directory named for
its owning topic: `<oracle-root>/<topic>/<claim-anchor>.<variant>.test.ts`, or
`<oracle-root>/<topic>/<claim-anchor>.test.ts`. A structural obligation's tests
live with the topic that states it. Neither the topic directory nor the filename
selects the test environment.
Imports show reachability, not execution or proof of a claim.

Harnesses connect contracts to real or fake implementations. These connections
establish their environment requirements. Real DOM use needs a browser; real resource
access needs its contract environment. Requirements compose. An unresolved connection
cannot silently select a cheaper environment. Supplying a fake does not erase a
direct import of the real implementation.

Each adapter with a fake has one contract suite run against both implementations,
including the contract's timing and failure behavior. The Kit checks that the suite
and both runs exist; execution proves their results. Separate integration tests prove
real wiring. Fake-backed tests do not replace required surface proof or the owner's
reference rendering.

Ordering, atomicity, idempotency and exclusion are claims in the owning topic,
proved at the composition where they matter. Completing each request once does
not prove that concurrent requests preserve an established binding.

Cost tests observe boundary inputs and outputs. Production code does not maintain
counters solely for tests. A test-only observation hook must be declared once in the
app's configuration; undeclared hooks are findings.


## The kit's own modules for the rules

### core/readings/snapshot — one normalised value of a codebase
- def: the files (path), the imports (from → to), the spec headings (module identities), the test files, the debt lists
  and the config. Every check reads only this value.

### core/readings/finding — what a check reports
- def: `{ rule, path, fix, debtKey }`. The fix says, in one sentence, the change that clears the finding.

### core/readings/binder — R3: module headings bind to files and proofs name topic claims
- def: a finding for each module heading with no file, each placed file with no heading, and each claim-first test
  with no matching claim in its topic. Every claim has at least one proof.

### core/readings/name-check — R3: names are built from defined terms
- def: a finding for each term defined twice, each word of a module name or exported symbol that is
  neither a term nor a connector the config declares, and each retired word anywhere in the spec, the code names,
  the test names or the comments.

### core/readings/comment-check — R3: comments cite nothing and carry no debt
- def: a finding for each claim anchor, Markdown file or module identity cited in a placed file's comment, and each
  debt marker the config declares.

### core/readings/dependency-check — R2: imports point forward within a zone and inward across zones
- def: a finding for each import that points upward through the layers or crosses zones outward, and one for each cycle.

### substrate/primitives/read-snapshot — read a repository into a snapshot
- def: walks the configured roots, reads imports and spec headings, and lists the test files. It is the kit's only
  effect, and the only place a language adapter lives.


### core/readings/capability-check — authority and structural findings
- def: derives module capabilities from compiler facts and runtime imports, reports placed violations, legacy debt and explicit checker limits.

### core/primitives/default-config — shared configuration contracts
- def: the configuration schema and default roots, with app-specific capabilities supplied by the caller.

### core/primitives/zones — zone roster
- def: the three permitted zones.

### core/readings/placement-of — placement interpretation
- def: reads declared zone and layer paths without assigning a placement to legacy files.

### core/readings/claim-inventory — structural declarations and references
- def: reads Markdown structure to distinguish closing claim declarations from references.

### Proof obligations
- The ratchet rejects new legacy debt, every placed violation and every checker limit reachable from placed code. · {#ratchet-keeps-architecture-obligations}
- runtime authority is conservatively derived from actual module inputs. · {#authority-is-derived}
- binder: one path in spec, code and oracle. · {#binder-binding}
- a cache hit reuses extraction, reruns the checker and retains unresolved evidence. · {#cached-check-keeps-evidence}
- a core composition may produce an actual write set without a primitive constructor wrapper. · {#capability-producers-follow-layers}
- a debt marker in a comment is a finding whose fix moves it to a debt list. · {#comment-check-carries-no-debt}
- a comment that says why the code is built this way is free. · {#comment-check-cites-nothing}
- the kit. · {#comment-check-self-hosted}
- a chain is acyclic. · {#dependency-check-acyclic}
- Within a zone, imports point down or sideways through primitives, readings and compositions. · {#dependency-check-direction}
- every kit source file under src/ is placed. · {#dependency-check-self-hosted}
- a finding carries rule, path and fix, and a debt key from rule, check, path and detail. · {#finding-debt-key}
- Placement is read from <root>/<zone>/<layer>/<name>; an old kind folder is legacy, not a placement. · {#kind-of-layout}
- omitting the directory mapping retains the three canonical default layers. · {#layers-map-paths}
- nameCheck: module names and exported symbols use only terms and connectors. · {#name-check-built-from-terms}
- a term defined once has no finding. · {#name-check-defined-once}
- a retired word in a name is a finding, and its fix names the term that replaced it. · {#name-check-retired-words}
- the kit. · {#name-check-self-hosted}
- a parenthesized index is outside the directly indexed assertion permission. · {#project-imports-carry-authority}
- the fixture reads as its files, imports and headings. · {#read-snapshot-fixture}
- the real snapshot reader discovers every independently supplied case input. · {#readings-use-data}
- Claim declarations and topic-first proofs bind in both directions, without treating paragraph reflow as a new declaration. · {#claims-have-one-home}

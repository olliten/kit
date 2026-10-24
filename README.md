# Kit

Architecture as a check, for codebases that agents write.

Verification planning is also portable. `scripts/kit-verification.mjs` exports `verification()` to load the
pure evidence planner and duration-aware partitioner, and `runVerification(checks, io)` to execute a dependency
graph with supplied effects and resource capacity. Checks declare stable identities, input fingerprints,
execution contracts and required strength. The caller supplies discovery, input tracking, evidence storage
and policy. A fresh policy runs every required check; an incremental policy reuses only matching successful
evidence. No branch name, Git provider or test framework is built into the planner.

For checks with declared filesystem inputs, `declaredInputFiles` in
`src/substrate/adapters/declared-input-files.ts` resolves files, suffix-filtered trees and path-kind probes
into an input key. Data and code are separate domains; the caller supplies the key format and runtime
identity. This keys only declared inputs: it does not discover a check's reads or choose its cache policy.

## Why

Most conventions in a codebase exist so a person can read it. Agents don't read that way: an agent starts each
task with no memory of the codebase and finds code by searching. What agents tell each other isn't in the repo
for the next one.

Agents drift in a specific way. An agent solves the task in front of it. It doesn't know the codebase has a word
for the thing, so it adds a second word. It doesn't know a function already does this, so it adds a wrapper. Each
choice is defensible alone. Together they are two names for one concept, two paths to one effect, and indirection
nobody designed. The next agent reads that and understands less. With several agents at once, this compounds.

A document doesn't prevent it: the first app Kit was written for had the architecture in its instructions, and
its agents drifted anyway. A check prevents it, if it runs on every change and fails the one that starts the
drift. That is Kit. A person decides what the product promises and what the words mean, in the spec. Agents write
the code. The check keeps the two consistent.

The same structure is what lets agents work in parallel. One module per file and one test file per claim mean
two tasks on different features edit different files. Effects behind adapters mean a module's imports show every effect it can
cause, so an agent can change one module knowing what else it can affect, without reading the modules another
agent is changing. And a headless core means the whole suite runs in seconds, so every agent's change goes through the
gate without waiting on the others.

## Humans and agents

| What a developer does | A person | An agent | So Kit makes the codebase | What that costs |
|---|---|---|---|---|
| **Reads** code | Opens a file and scrolls. Prefers a feature on one screen | Starts with no memory. Searches, opens the few files the task needs, ignores the rest | One module per file, hundreds of files | A person reads this codebase worse than a conventional one |
| **Places** a module | Picks the folder it belongs to. A shared module belongs to several, so it ends up in `utils/`, and the tree stops meaning anything | Picks the folder that looks right for this task. Another agent, another task, picks another | The path answers one question only, what the module may do: `src/<zone>/<layer>/<name>.ts`. Twelve folders, the same in every app | The tree says nothing about features |
| **Groups** modules into a feature | The folder tree, decided once, reorganised at great cost | Nothing. It sees files, not features | A topic states one feature's claims, and each claim names the modules it depends on, from any zone. A module's claims are derived from those names | Regrouping is a spec edit, which a person ratifies |
| **Finds** where things live | Browses the tree | Searches a name | The path follows from the role; `kit refs` lists the claims a module keeps | Names must be true, or search finds nothing |
| **Remembers** the design | In their head since last month; docs are a reminder | Nothing between sessions. A doc not read this time doesn't exist | Everything that matters is in the repo, in a form the check reads: topics, terms, claims | The spec is the design. Cut it badly and the check enforces that |
| **Decides** a change | Sees the whole; bends a rule when it makes sense | Sees the task; can't tell deliberate structure from accident | Decisions live in a core with no effects, where a check can see them. Rules are absolute | No exceptions; changing a rule means changing Kit |
| **Writes** it down | Prose costs time, so comments, specs and tests stay thin | Writing is free; it produces a definition and a test for anything | Every module has a term and a claim that names it; every claim has a test | Each sentence lands on the person who ratifies it |
| **Proves** a change works | Runs the suite before pushing; tolerates a slow one | Runs it on every change; with many agents, many times an hour. How long the suite takes sets how fast everything merges | Decisions in a headless core, so most tests run in a plain process in seconds. The browser covers only the shell | Browser and transport are still proved, separately and less often |
| **Reviews** work | Reads the diff | Writes faster than anyone can read | The person reviews the spec: promises and words. The check reviews the code | Quality below the claim goes unreviewed |
| **Works alongside** others | A few people, who share a running picture of the code; conflicts settled in review | Many at once, each with its own picture; a conflict is a failed merge | Two tasks on different modules edit different files: one file per module, one test file per claim, effects behind adapters | Real only once the check runs in CI |
| **Lives with** the codebase | It degrades slowly, and someone refactors | It degrades at the rate it's changed, and no agent is in a position to see that | A change that would degrade it fails | A rule an agent can't satisfy stops it until a person rules |

## Topics

A folder tree asks where a module belongs, and a shared module belongs in several places. Whichever you pick,
the other features import it from across the tree, and the tree stops describing the features. Kit separates
the two questions. Where a module lives is answered by what it may do, `src/<zone>/<layer>/<name>.ts`,
once and mechanically. What it's for is answered by the claims that name it, in any topic.

The spec is a set of topics, one file each, usually one thing a user does. A topic has one shape: a title,
an intro of at most three sentences, then sections and claims. Each claim names the production modules
that implement it and the shared test modules that construct its proof:

```markdown
# Review an article

A reviewer reads each waiting reading and accepts or declines it.

## Declining

- A decline cannot be saved without a reason in the reviewer's own words. · {#decline-needs-reason}
  - Implementation: {{decline}}, {{surface}}
  - Proof: {{decline-cases}}
```

`{{decline}}`, `{{surface}}` and `{{decline-cases}}` are terms, each defined once in `spec/terms.md` and bound
to one file. The first two name production modules, such as `src/shell/adapters/surface.ts`;
`{{decline-cases}}` names shared proof data in `oracle/core/primitives/decline-cases.ts` when `oracle/`
is a governed code root. Name the modules the proof actually uses, including shared generators,
reference models, comparisons or drivers; a module reused by several topics is named by each relevant
claim. These use the same term syntax and glossary as production modules. The anchor binds the claim to
`oracle/review-an-article/decline-needs-reason.test.ts`. A claim with no test, a test that names no claim, a
module no claim names, prose outside a claim: each fails. So a topic is a map of its feature that the check
keeps accurate: what it promises, what implements it, what proves it.

`Implementation` names modules providing the claimed behavior; `Proof` names reusable machinery used
to establish it. These are relationships to this claim, independently of code root: an oracle helper
can implement a claim about test infrastructure. Both lists use the same resolver and checked reach.
Each row appears at most once and contains only distinct, comma-separated references. Omit a row when
there are no modules to name. Existing inline references remain supported without assigning them an
implicit role.

Claims may also be table rows. Each data row is one claim, with its anchor closing the final cell:

```markdown
| Command | What it does | Available when |
| --- | --- | --- |
| Decline | Saves the reviewer's reason. | An article is open. · {#decline-needs-reason} |
```

All cells together state the claim and contribute their references. The same anchor binds the same
proof file whether the claim is a list item or a row. Optional `Implementation` and `Proof` columns
hold comma-separated module references; an empty cell omits that relationship. Headers declare no
claims. If row order or table completeness is a promise, state and prove it as a separate claim.

The claim test is the outer proof entry: it registers cases, wires modules and asserts results.
Reusable proof modules use the same adapters, primitives, readings and compositions as production
code. They do not repeat the claim anchor. A straightforward test needs no separate composition merely
to conform to the structure.

The reverse view is derived, never written into the module: `kit refs src/shell/adapters/surface.ts` lists
every claim that names the surface, in any topic, with its tests. Run as a Claude Code read hook
(`.claude/settings.json` in this repository), it adds that list to what an agent sees when it opens the file.
An agent changing a module knows which promises it can break without reading the topics, and two agents never
edit the same header to record what a module is for.

## A feature

An agent gets the task *decline a whole article with one reason*.

1. It opens `spec/review-an-article.md` and reads its claims and the modules they name. Nothing else.
2. It adds one claim: `- A reviewer may decline every waiting reading of an article with one reason. ·
   {#decline-whole-article}`, naming the modules it depends on. A new module also gets a terms line. This diff
   is the design.
3. It writes `oracle/review-an-article/decline-whole-article.test.ts`. That is the definition of done.
4. It writes the module at `src/core/compositions/decline-article.ts`. The core is pure, so the test runs in
   milliseconds without a browser. An effect it lacks is a finding naming the adapter to declare.
5. `kit check` exits 0 and the tests pass. The person reviews the claim in the spec diff.

## The rules

**R1, zones and layers.** Code lives in three zones:

- `core` decides and performs no effect.
- `shell` renders and turns input into data.
- `substrate` does I/O.

Each outer zone runs in a host: a runtime whose globals come from compiler libraries. Shell runs in a
`dom` browser and substrate in a `node` server unless `hosts` says otherwise; the core runs in none. A
global exists in a host only if one of its libraries declares it, so Window-only authority stays where
the DOM is, whatever an adapter permits. Imports and callbacks retain the requirement. Plain supplied
options are data.

Each zone has four layers:

- `primitives`: types and constants.
- `readings`: facts derived from data, with no effects.
- `adapters`: one external capability each, behind a plain contract.
- `compositions`: the others wired into behaviour.

So the core is headless: its decisions run in a plain process. That is where most tests live, and why the gate
stays short enough to run on every change. And every effect has exactly one adapter it happens in.

**R2, dependencies.**

- Primitives import primitives.
- Readings import primitives and readings.
- Adapters import only primitive data contracts.
- Compositions may import all four.
- Across zones, imports point inward to the core.
- No cycles.

So a module's imports say exactly what it can reach, and changing a module can't affect anything below it.

**R3, names and comments.**

- Every placed module is a term defined once in `spec/terms.md`, with its role and zone.
- Every comment says only why.

So a word means one thing everywhere, a path says what a module may do, and the code never restates or
contradicts the spec.

**R4, proof.**

- A topic is a title, a short intro, sections and claims; nothing else.
- Every claim in the spec has a test, and the code its tests use reaches the modules it names.
- Every test names a claim.
- Every placed module is named by a claim.

So the spec is only promises that are proved, no test exists without saying what it proves, and no module
exists without a promise it keeps.

A change that breaks a rule fails the check. Existing code is legacy until it's moved into place; its findings
are debt that may only shrink, and so is its size. A change may add no statement to a legacy module, not even
a call into a placed module; new code is placed first, so nothing new lands in the old shape.

## Headless and modular

*Headless*: the core runs without the browser, the network or storage. All of its logic is proved in a plain
process, so the gate is seconds, not minutes, and runs on every change from every agent.

*Modular*: one module per file, imports one way, each effect behind one adapter with a plain contract. A change's
reach is known from its imports, so agents can change modules at the same time without reading each other's work.

Kit enforces both. It doesn't decide whether the modules are the right ones. That's the spec, and a person
ratifies it.

## The shape

```
spec/
  terms.md                     every word, defined once
  review-an-article.md         one topic per feature: its claims, which name its modules
  research-a-client.md
src/
  core/      {primitives, readings, adapters, compositions}/<name>.ts
  shell/     {primitives, readings, adapters, compositions}/<name>.ts
  substrate/ {primitives, readings, adapters, compositions}/<name>.ts
oracle/
  review-an-article/<anchor>.test.ts    one file per claim
  research-a-client/<anchor>.test.ts
kit/
  config.md                    the app's declarations
  debt/legacy.json             what isn't placed yet; only shrinks
```

To govern shared test modules too, declare a list in `kit/config.md`:

```yaml
roots:
  src: [src, oracle]
  spec: spec
  oracle: oracle
```

Each code root uses the same zones and layers. Module identities in this configuration include the
root, for example `oracle/core/primitives/decline-cases`; adapter registrations use those identities
too. Term names stay globally unique. `roots.oracle` still selects claim proof files. Existing scalar
`roots.src: src` configurations keep their module identities.

Hosts answer where code runs and what it may touch:

```yaml
hosts:
  browser: { lib: [dom], zone: shell, entries: [src/shell/startup.ts] }
  server:  { lib: [node], zone: substrate, entries: [src/substrate/startup.ts] }
  proof:   { lib: [node], roots: [legacy-tests/], provides: { vitest: [describe, test, expect] } }
  page:    { lib: [dom], entered-by: [playwright-core#PageFunction] }
```

A host's `lib` names the compiler libraries (`dom`, `webworker`, `node`) or packages whose ambient
declarations exist there. In each host one adapter owns each global it declares; other code in that host
acquires it through that adapter, and two hosts may each own the same name. A host starts at its
`entries`: exact files outside every zone that may wire the outer zones' contracts. Nothing imports an
entry, and its imports gain no permission. Every claim test is an entry of the `proof` host, derived from
its binding; only the entries a host lists are compiled and checked. `provides` selects named runtime
exports of an effectful package, such as a test runner, for the host's entries; helpers gain no runner
permission from a proof that calls them. The proof host's `roots` add test discovery directories.

`entered-by` names the types that carry code into a host, by the package whose declarations define the
type. A function literal of that type, such as a browser-automation page function, is checked in that
host and charges nothing to its caller; an outer name it captures is a finding, because the host runs a
serialized copy. A reference, an `any` or a source string stays a limit.

`npm run migrate-config -- kit/config.md` rewrites the older `exceptions`, `legacy-test-roots` and
`packages[].entrypointExports` keys as hosts. The old keys are read for one more release with a
non-blocking `deprecated-config` note.

## Adopt

Use dependency exclusions for boundaries that imports must not cross:

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

Selectors name existing files or directories, without patterns. The first rule forbids direct
production imports of oracle code, including types. The second follows runtime dependencies through
helpers and re-exports to keep a reference model separate from the implementation it judges. Erased
type contracts remain allowed. Transitive checks retain uncertainty at opaque boundaries, even when
a package is declared pure. These checks establish dependency separation, not model correctness.

Direct checks also use an ambient module's single declaration home, such as Node built-in declarations.
That evidence does not classify the package as pure or establish its runtime dependencies. Multiple
ambient declaration homes retain uncertainty; transitive checks still require runtime import evidence.

```sh
git clone <this repo> ../kit && (cd ../kit && npm install)
```

Add `kit/config.md` mapping your folders to zones, `spec/terms.md` with your domain's words, and a baseline of
today's findings and legacy sizes. Run `kit check --base <the pull request's base ref>` in CI, so a change that
edits a claim's test without its topic fails, and `kit check --tighten` after a change lands, so
paid debt and shrunk modules leave the baseline. Nothing users see changes. For the read hook, point a `PostToolUse`
hook on `Read` at `kit-refs.mjs --hook --root . --config kit/config.md`.

## This repository

Kit is written in its own structure and checks itself. Rules: `spec/`. Reasons: `docs/decisions.md`. `npm test`,
`npm run check`, `npm run refs -- <module>`, and `npm run consumers -- ../app …` to see what a change to the Kit
means for each app that uses it.

The shared oracle infrastructure is being adopted one capability at a time. Both `src/` and `oracle/`
are governed code roots. The headless snapshot builder is a Core reading at
`oracle/core/readings/fixture-snapshot.ts`; its 17 claim-test consumers keep their topic filenames and
assertions. Production imports of oracle code, including types, are forbidden.

The oracle adoption inventory was taken at `83ffb2a`, with the second code root enabled and adapter
identities qualified by root. It contained six legacy modules: 91 executable statements and 21 calls.
Moving the snapshot builder pays its 24 statements and seven calls; the claim-binding reading pays
another six statements and four calls. The fixture inventory and configuration pay four statements and one
call. Moving the source-fixture workflow and its temporary-project adapter pays another 17 statements
and three calls, leaving only the cache fixture with 40 statements and six calls
in `self-debt/legacy.json`. That inventory adds no source-module waivers or
checker-limit waivers. The remaining infrastructure stays under the ratchet until its capability is
migrated. The `imports-point-inward` and `imports-have-no-cycles` claim tests are also entries the proof
host lists. The proof host provides only Vitest's `describe`, `test` and `expect`; their shared snapshot
reading has no runner permission. Other claim-test files retain their existing compiler and claim-reach checks
until their infrastructure is adopted.

Compiler fixtures use `oracle/substrate/compositions/source-fixture.ts` to prepare the input, run Kit and
dispose the project in `finally`. The `temporary-project` adapter owns directory creation, file writes
and disposal; its resource can be reused by other fixture workflows without importing a runner. A
checked claim covers isolation, failed-write cleanup and compiler root/path settings.

The self-conformance claim runs its six cases over one real configured repository snapshot. Its term,
comment, binding, placement and import assertions share that input; ordinary language and structural
proofs still use their own cases. This removes repeated extraction without dropping assertions or
introducing a cache between test runs.

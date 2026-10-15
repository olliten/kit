# Decisions

Why the Kit is the way it is. Each entry gives the date the maintainer ratified the decision, what it decided and
why. The spec in `spec/` says what holds now; where an entry and the spec differ, the spec wins and the entry is
history. The Kit was built and first installed inside one app. Evidence from that installation is described here
without naming the app.

## 2026-10-11 · A portable kit with a per-app config

- **Decision:** one set of structural checks, with a spec, an oracle and a fixture, that names no app concept.
  Each app declares its layout in a config. Agents treat each finding's fix as the instruction.
- **Why:** if agents only ever make the checks pass, a codebase converges to one structure. In that structure every
  rule lives once, everything that decides runs headless, and each part is tested where it is cheapest to prove.
  Because the Kit names no app concept, a different app converges the same way.

## 2026-10-11 · Three zones, by what code may do

- **Decision:** core decides and performs no effect; shell renders and normalises input and decides nothing about a
  core fact; substrate performs I/O and holds no domain rule. Dependencies across zones point inward.
- **Why:** domain decisions then run without the browser, transport or storage, so they are proved headless.

## 2026-10-11 · State is generic; storage styles are app properties

- **Decision:** state is "written only by applying a write set". Event sourcing, undo and replication are properties
  an app declares, never assumptions of the Kit. One substrate store holds every state cell. A change returns a
  write set plus effect requests, and effect results come back as normalised input. Time and fresh ids are inputs.
  A memoized reading is allowed when the memo always equals the reading.
- **Why:** a read-only dry run on the first app found the first model wrong in about a dozen places. Persisted
  fields there were folds of an event log, not stored values. The core could not hold a state cell, because it may
  not perform effects. Optimistic copies, long-running flows and identity-keyed memo caches had no home. Making
  these app-declared properties lets a plain stored-value app use the same Kit.

## 2026-10-11 · Opt-in by path, a ratchet, and whole-tree convergence

- **Decision:** a module is held to the rules once it sits at `<zone>/<layer>/<name>`. Everything else is legacy,
  recorded as debt. A change never raises total debt. Every source file eventually lives in a zone or in an
  exception the config declares.
- **Why:** the Kit then installs into any codebase whose gate is green, and legacy can only shrink.

## 2026-10-11 · Strict binding: identity is a name

- **Decision:** a module's identity `<zone>/<layer>/<name>` is the same in the spec heading, the source file and
  its tests. Names are kebab-case; code symbols stay camelCase. The identity is a name, not a path. Agents never
  invent a split: a new module starts as a maintainer-approved heading. "Artifact" was renamed "module".
- **Why:** one name in all three places lets a rename move spec, code and tests together, and lets the binder
  find every module that lacks its counterpart.

## 2026-10-11 · Topics carry intent; features reshape topics first

- **Decision:** a topic explains why its modules exist and how they compose; it groups meaning, never code. A
  feature is a topic that names something a user can do. A feature first checks whether the topics still fit,
  proposes a regrouping when they do not, and reports its topic footprint.
- **Why:** in a dry run on the first app, an agent working from a feature-sized topic opened about 5k words of
  spec instead of about 55k. It worked only when editors handed their draft back to whoever opened them; without
  that, topics referenced each other in cycles.

## 2026-10-11 · One terms file (R3 Names)

- **Decision:** one terms file defines each term once, as `- **term** — meaning`, with optional retired words.
  Topics use terms and define none. Code names use only terms. The Kit's own examples are neutral (a running
  total, a step, a limit), because the Kit names no app concept.
- **Why:** a vocabulary dry run on the first app found that about 60 of 155 recorded concepts were really module
  names, about 25 heavily used words were defined nowhere, and about 15 words carried two or more meanings. A
  closed vocabulary replaces alias lists.

## 2026-10-11 · Comments hold only why (R3 Comments)

- **Decision:** a comment explains why the implementation is built this way. It cites no anchor, Markdown file or
  module identity, and carries no debt marker; debt lives in a debt list.
- **Why:** in the first app, about a fifth of source lines were comments, and thousands of them cited spec
  anchors or files. The reason beyond that evidence is not recorded.

## 2026-10-11 · No journeys

- **Decision:** surface tests run on the real core and substrate, so each proves its wiring. A shell render's look
  is proved by a ratified reference rendering. A data module equals the roster under its heading.
- **Why:** not recorded.

## 2026-10-12 · Layers replace kinds; claim-first proof; a cached check

- **Decision:** the five kinds (data, state, reading, change, effect) were replaced by four layers per zone:
  primitives, readings, adapters and compositions. Only adapters create authority. Topic claims bind to tests
  named by claim anchor, and several tests may prove one claim. One structural Markdown reader tells declarations
  from references. The check caches extraction, never a verdict. Checker limits are explicit and never become
  debt; any limit reachable from placed code fails.
- **Why:** the installation records the result, not the reasons for the kinds-to-layers change. Caching followed
  from cost: cold extraction took about 113 seconds on roughly 70k lines of production source, checking under a
  second. Pre-commit use waits on incremental extraction.

## 2026-10-12 · Indexed non-null assertions are not type escapes

- **Decision:** a non-null assertion directly on an indexed access (`arr[i]!`, `match[1]!`) is permitted. Other
  non-null assertions and every non-const `as` remain type escapes.
- **Why:** `noUncheckedIndexedAccess` requires this handling, and ESLint permits it.

## 2026-10-12 · Shell clock and randomness through narrow adapters

- **Decision:** the shell may sample the clock and randomness through narrow capability adapters.
- **Why:** not recorded. The permission covers the whole shell, with no exception for one feature.

## 2026-10-13 · Whole-concept binding and marked references

- **Decision:** the Kit's wording was ratified, including whole-concept binding and the `[[Topic]]` / `{{term}}`
  reference notation. Language binds whole module concepts instead of taxing every word in exported identifiers.
  Supporting symbol spellings create no extra terms. Later wording changes need their own ratification.
- **Why:** not recorded. The transition notes add that debt caused only by symbol spelling retires with the old
  rule, and is never drained by adding glossary fragments.

## 2026-10-13 · Topics group modules without exclusive ownership

- **Decision:** each module has one concept definition and one source identity. A module may appear in several
  topics or in none. Topic references create no module and change no import permission. Each claim still appears
  once. Mandatory unique module headings were retired; groups are derived from references, with no membership
  registry.
- **Why:** not recorded.

## 2026-10-13 · Approval needs no label

- **Decision:** Kit changes still need the maintainer's approval, but the approval no longer needs a GitHub label.
- **Why:** not recorded. Approval still skips no check.

## 2026-10-13 · Core constructs changes; outer compositions may invoke them

- **Decision:** only declared core producers construct write descriptions and make their domain decisions. Shell
  and substrate compositions may invoke those core changes and carry their descriptions. Readings neither
  construct write descriptions nor invoke changes that produce them.
- **Why:** treating every caller as the owner of construction stopped an ordinary placed UI or resource
  composition from invoking a pure core change, and moving the caller elsewhere did not resolve it.

## 2026-10-14 · Legacy claim declarations during migration

- **Decision:** in configured legacy area files, an anchored claim paragraph may be followed by nested
  explanatory bullets, and a `### law · id — explanation` heading declares its claim. New topics keep the strict
  rule that the anchor closes the whole claim item.
- **Why:** not recorded. One structural reader handles both modes, and reference, reflow and duplicate-declaration
  checks still apply.

## 2026-10-14 · Imports across the migration boundary

- **Decision:** legacy layer ordering governs legacy-to-legacy imports, and Kit layer ordering governs
  placed-to-placed imports. Imports between them still obey zone boundaries and transitive capability
  restrictions. A legacy module without a Kit layer is not assigned a fictitious layer.
- **Why:** valid pure legacy connections stay valid, while core-to-shell access and readings that reach writers
  or effects stay rejected. No new permission or debt growth is granted.

## 2026-10-14 · Declared legacy dependencies

- **Decision:** during migration, a term's `From` and `Of` may name an existing unplaced source by repository path.
  Placed dependencies still resolve through their module terms. The declaration grants no zone, layer,
  capability or cycle permission and grows no debt.
- **Why:** the unchanged checker rejected a placed module that imported an existing legacy owner, so migration
  could not proceed one module at a time.

## 2026-10-14 · Its own repository

- **Decision:** the Kit moved out of the first app into this repository. Its spec, source, oracle and fixture sit at
  the root. Each app keeps its config, debt and ledger. The history was replayed with app-specific content
  removed. The person who ratifies is the maintainer; "owner" keeps only its code meaning.
- **Why:** a second codebase is adopting the Kit, and agents should see the reasons for its rules without the
  first app's context.

## 2026-10-15 · Gaps the second app found

- **Decision:** an ambient global from an installed package, such as Node's `process`, `require` or `Buffer`,
  counts as host authority. Code that uses it without an adapter that declares it in `globals` is an explicit
  limit, also when reached as `globalThis.<name>`. A cast of `globalThis` erases which global is reached, so it
  is a dynamic access. A missing terms file is a finding. Paths a caller gives `kit check` resolve against the
  caller's directory; with none, the Kit checks itself.
- **Why:** the first check of a second app passed code that reads files through
  `(globalThis as any).process.getBuiltinModule('node:fs')`, said nothing about its missing terms file, and could
  not be run from the app's own folder. Treating every type declared by Node as authority was tried first: it
  also caught plain data such as directory entries, and gave the Kit 84 limits on itself.

## 2026-10-15 · A declared host global covers what it reaches, inside its adapter

- **Decision:** inside an external adapter, a host global it declares (`document`, `fetch`, `navigator`) covers
  every native handle reached through it: elements, responses, the clipboard. The adapter's contract still
  decides what leaves; a composition holds a native handle only when a contract names its type.
- **Why:** before this, each handle was its own native root and had to appear in the contract, so adapters
  passed only by naming DOM types in their contracts. That hands live elements to compositions and defeats the
  adapter. The second app's surface adapter hit this on its first page. The first app's render adapter had
  taken the contract route; it may now narrow its contract.

## Not yet built

- `kit ledger`, `kit partition` and `kit rename`; only `kit check` exists.
- Incremental extraction, which pre-commit use waits on.
- A published command and build: `scripts/kit-check.mjs` runs the TypeScript source through vite-node.
- Validation of the config: the runner reads roots, terms, claim separator, legacy areas and zones, adapters and
  packages. Other keys are ignored silently, and `layerNames` is not passed through from the config file.

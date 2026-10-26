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

## 2026-10-15 · Topics hold only claims; claims name their modules

- **Decision:** a topic is a title, an intro of at most three sentences, `## ` sections and claims, and nothing
  else. Every claim has a test; there is no untested or reviewed-only claim. A module has no heading in any
  topic: it is defined once in the terms file, and each claim names the modules it depends on as `{{term}}`. A
  placed module that no claim names is a finding. A module's claims are derived by `kit refs`, which a read
  hook shows to an agent opening the module; nothing is written back into the module. Each list in the terms
  file is alphabetical. What the old topics required but no test proves moved to "Not yet built" below.
- **Why:** the Kit's own topics were about 670 lines, mostly prose rules no test bound, so the check could not
  tell a kept rule from a forgotten one. A fixed shape leaves a requirement nowhere to live but a tested
  claim. Module headings gave each module one home topic, which a shared module does not have. Writing a
  module's claims into the module would go stale and make parallel edits collide; deriving them costs
  nothing. Matching modules to claims needs little judgment once the modules are defined. Sorted terms let
  agents adding different terms edit different lines.

## 2026-10-15 · Apps pin the Kit and converge to it

- **Decision:** each app pins a Kit commit as a git dependency and runs the Kit from `node_modules/kit`. A
  learning from either app is fixed in the Kit, with its test, never worked around in the app. Before a Kit
  change merges, `kit consumers` shows what it means for each app; the change may still turn an app's check
  red. Each app then moves its pin in a pull request of its own and converges its code to the new findings.
  No deploy runs the Kit, so an app whose check is red still deploys.
- **Why:** two apps develop at once, and what one teaches the Kit should reach the other. A pin keeps every
  machine on the same Kit and makes each upgrade a visible change. Holding a Kit change until both apps pass
  would make the slower app set the pace; a red check is a list of work, and the ratchet keeps it from
  growing.

## 2026-10-15 · A declared startup file, and native contracts in Substrate

- **Decision:** an app may declare an exact startup source file outside every zone (`exceptions` in its config).
  It may connect Shell and Substrate contracts and use the core's; nothing imports it, its permission does not
  pass to its imports, and the ratchet counts limits reachable from it as it does from placed code. A native
  capability contract is usable in any outer zone its registered adapter permits, Substrate included.
- **Why:** the first app's sign-in work needed a process entry that wires the server and the page, which no zone
  may do, and a Substrate adapter for a native contract, which only Shell could hold. The maintainer approved
  both there; the change was written against that app's pinned Kit and kept on `leeloo/startup-boundaries`,
  and is ported here so every app gets it.

## 2026-10-16 · A cache keyed by what extraction read, and ignored paths

- **Decision:** the snapshot cache records every read extraction makes, through the filesystem adapter and one
  traced compiler system: file bytes as digests, directory listings, existence probes that found nothing,
  realpaths, directory reads and environment reads. An entry is reused while each read returns the same, under a
  header of the Kit's source, the TypeScript version, the platform, the working directory and the config. Entries
  live in the common Git directory, so worktrees share them, and are evicted least recently used past 2 GB
  (`KIT_CACHE_MAX_BYTES`). An app may declare `ignore` paths the walk never lists; an import into one is an error.
  `kit check --fresh-compare` extracts again and fails on any difference. This replaces the whole-tree
  fingerprint.
- **Why:** on the first app the fingerprint hashed every byte under the root and every package declaration, so a
  generated evidence file written each commit missed the cache and cold extraction, about four minutes, ran
  again. A trace misses only on a change extraction could see.

## 2026-10-16 · A claim's tests reach the modules it names

- **Decision:** the modules a claim names must be reached, through imports, by the claim's tests taken
  together; a named placed module none of them reaches is a placed violation. Reach is the import closure from
  each test file, helpers included, so a type-only import counts and a module loaded only by a spawned process
  does not. A name that is no placed module is left to the reference check.
- **Why:** a claim's names are how `kit refs` and an agent find what a module promises, and nothing proved
  them. Run on the Kit, the check found a claim naming the module that doesn't produce its finding, and a
  named module its test never touched. Each test alone would be too strict: variants prove parts of a claim.

## 2026-10-17 · Binary data is data

- **Decision:** the typed arrays (`Int8Array` through `BigUint64Array`, `Uint8ClampedArray` included),
  `ArrayBuffer`, `SharedArrayBuffer` and `DataView` join `Array`, `Map` and `Set` as built-in data collections:
  their default-library members are data access, so a reading or a Core composition may take them. Their type
  arguments are still read, and a subclass that adds a method is supplied behaviour. Node's `Buffer` is not one
  of them: it stays supplied behaviour as a parameter and an ambient global as a value.
- **Why:** each only reads and writes its own memory. `SharedArrayBuffer` is included because sharing it needs
  `postMessage`, which is authority of its own, and `Uint8Array`'s buffer type argument names it. `Buffer`
  carries Node's encoding, pooling and allocation semantics, and the maintainer ruled it authority.

## 2026-10-17 · A package an adapter declares is that adapter's

- **Decision:** an external adapter row may list `packages`, as it lists `globals`. Only that adapter's module
  may import a listed package at runtime, and the import grants it the row's capability. A runtime import of it
  anywhere else, the core included, is a `package-import` finding, also when a package row declares the
  package, so a row with no capabilities cannot open it to the core. A type-only import costs nothing, and a
  package no row declares stays an external-boundary limit. Package rows keep their meaning for every other
  package.
- **Why:** a package row grants its capabilities to whichever module imports it, so a row for `node:fs` let
  any substrate composition read files beside its adapter, and a row declaring none let the core import
  `node:crypto`. The first app's Sign-in work has adapters over `node:crypto`, `node:child_process`, `node:fs`,
  `node:os` and `better-sqlite3` that no row could tie to them, and `js-yaml` used outside any adapter. The
  `process` and `Buffer` globals needed no change: an adapter's `globals` already bind them to it.

## 2026-10-17 · A legacy zone row of exact files, which only shrinks

- **Decision:** a `legacy-zones` row may list `files` instead of a `root`. Only the listed legacy files take its
  zone; a file added beside them takes none and keeps its migration-zone limit. Each listed file is a
  `legacy-zone` debt finding, so the app's baseline records the row's set like any debt: removing a file from the
  row shrinks it, and listing a file the baseline lacks is new debt the ratchet rejects. A listed placed module
  or missing file is a `legacy-zone-row` finding and gets no zone. Prefix rows are unchanged.
- **Why:** the first app's top-level legacy files (thirteen in `src/` and those of `src/readwise/`) had no zone,
  which left 53 migration-zone limits on its Sign-in work. A prefix row of `src/` would clear them, but it zones
  every file later added at the top level and the startup file with them, and nothing would record which files
  it was meant for.

## 2026-10-17 · URLs and text codecs are values

- **Decision:** `URL`, `URLSearchParams`, `TextEncoder` and `TextDecoder`, as the host declares them (the DOM
  library or Node's types), are value types: holding, constructing or using one grants no native authority, is
  no ambient global and is not supplied behaviour to a reading. `URL.canParse` and `URL.parse` are part of the
  value; the object-URL registry (`URL.createObjectURL`, `URL.revokeObjectURL`) is not, and a method a project
  merges into one of these types is behaviour like any other. A host function declared by the DOM library, such
  as `fetch`, now carries the native handles it returns, so calling it is authority even when the caller reads
  no member of the result. `Request`, `Response`, `Headers` and `WebSocket` stay native handles.
- **Why:** they parse, format or transcode what they are given and do no I/O, yet each was a native root, so
  every placed module that parsed a query string or built a form body was a limit. On the first app's sign-in
  work they were most of the reachable native-authority limits. A core `fetch(url)` was caught only through its
  `URL` argument; making the URL a value would have let `fetch` through, so the host function carries its own.

## 2026-10-17 · A handle passed within one composition file needs no contract

- **Decision:** when a placed composition passes a handle or a callback to a function declared in the same file
  that no other file can name, the pass is not a callable-binding boundary and needs no contract. A function
  another file can name is a boundary as before: one it exports, by declaration, by name or as the default; one
  held by an exported record; a public or unprotected method of an exported class. An imported function stays in
  the file it was declared in, so a pass to it, re-exported or not, is checked as before. Readings keep every
  binding, and the file's own authority is still checked at the file.
- **Why:** the authority such a handle carries is already the file's own, and every way out of the file is a
  connection the check still sees: the call into the file's exported function, and the file's calls into other
  files. On the first app's sign-in work, compositions passing their own store, cipher and port handles to their
  own helpers were about a third of the reachable callable-binding limits.

## 2026-10-17 · A callable carries what it captures

- **Decision:** a callable handed to another module is charged the authority of what it captures, not its
  file's whole import cone. Extraction follows the callable's free names to the code they name, in any
  file and through re-exports and default exports: functions, classes with their methods and getters,
  object literals, variables with their initializers. `this` reaches its class or object literal. For a
  binding that can change (a `let`, or a value whose type is not deeply readonly) it follows, within the
  binding's own module, every write into it: assignments, method calls on it, arguments it is passed as,
  copies into other holders, and the callers of a function that returns it. The check charges the
  capabilities granted at positions inside the reached code, an adapter's file whole, every captured
  parameter what its type grants, and the callable's own module's captured parameters also what their
  callers supply. A callable a reading hands on is established only when every input of the reading's file
  is, as before. What can't be followed is charged its whole file, as before: `this` outside a class member or
  object-literal method, a namespace or dynamic import, an unresolved import, a value returned by an
  unnamed function that is not a callback, and code outside the snapshot's sources. A callable whose
  origin is a library function, such as a bound method, is now charged its capture too.
- **Why:** on the first app's sign-in branch every closure an inline port object or startup handed on was
  charged its file's whole cone, so modules whose own cones hold no native carried hundreds of limits from
  their callers. A limit should name authority the callable can reach. Writes from another module into a
  binding are left to the checks where that module passes a handle or a callable: following them made a
  closure carry code outside its file's cone, about twenty times the limits. The planted cases in the
  oracle keep the reach that matters.

## 2026-10-18 · Legacy does not grow

- **Decision:** a legacy module's size is debt that may only shrink. Size is counted in TypeScript statements,
  wherever they are nested, never in lines; a block or an empty statement is not counted, so reformatting,
  braces and semicolons move nothing. Each legacy source file under the source root is a `legacy-size` debt
  finding carrying its statements and how many of them do nothing but import, re-export or call a placed
  module, as the compiler resolves the callee. The baseline records both under the finding's key. A change may
  add at most five statements to a legacy module, and its other statements may not grow at all, so the only
  growth is a few calls into placed code. A module with no recorded size is new debt; a declared startup file is
  an exception, not legacy. `kit check --tighten` rewrites the baseline so it only shrinks: a paid key leaves,
  and a size entry takes the smaller of what it records and what the module holds, for each count, so allowed
  growth is never recorded. The allowance is the Kit's (`legacyGrowth` beside the debt markers), not an app's
  config value.
- **Why:** findings in legacy code were debt, but legacy code itself was not. A feature could add or rewrite
  hundreds of clean lines inside a legacy module and the check passed, because no new finding appeared, while
  the app's rule was that nothing lands in the old shape. Lines would let formatting decide; statements don't.
  The allowance is a Kit constant because rules are absolute in every app; a config that could raise it would
  waive the rule. Counting can't see a rewrite that keeps a module's size, since the snapshot holds no earlier
  version: an edit in place stays a reviewer's to catch. Adopting it needs each app's pin bump and a one-time
  baseline refresh that records every legacy module's size.

## 2026-10-18 · A test reaches what its code uses

- **Decision:** a claim's tests reach the modules their code uses, not every module their imports could load.
  Each test file's code is followed as a callable's capture is, into helpers and modules through the
  declarations its names lead to, and a literal dynamic import or an import for its effect alone reaches its
  module whole. A file reached whole lends everything it imports, and the code a test uses reaches the modules
  of only types it is written in. A test no project compiles keeps the import walk, so an app whose project
  file leaves its tests out sees no change until it includes them.
- **Why:** the import walk let one helper decide every test's reach. A test helper that imported every module
  so tests could load them made every claim reach every module, and the check passed while tests never touched
  modules their claims named; an app that kept its loader readable instead got a finding for every claim. The
  capture already says what code uses for authority (A callable carries what it captures), so the proof uses
  the same relation instead of a second one. It proves a test can run a module, not that a test would notice
  the module break: that is mutation testing's, and slow enough to stay out of the check.

## 2026-10-20 · A claim proof can be a checked executable entrypoint

- **Decision:** reuse exact startup declarations (`exceptions`) for proof entrypoints outside zones.
  The proof keeps its topic/anchor identity while compiler and authority extraction check its body.
  Nothing imports an entrypoint; its wiring permission does not spread to helpers. Violations in any
  declared entrypoint, including application startup, cannot be recorded as legacy debt. Existing
  startup finding keys remain stable.
- **Why:** being a claim proof and being executable are separate facts. Reusing entrypoint checks avoids
  a second zone or authority engine and lets adoption proceed one proof at a time. A filename grants no
  permission. Framework imports remain unresolved until an operation contract establishes them;
  registering a proof does not make a framework package pure. This does not yet classify all proof
  files or support nested claim paths inside a zone.

## 2026-10-20 · Selected package exports at executable entrypoints

- **Decision:** an effectful package declaration may select `entrypointExports`. Only exact declared
  entrypoints may import those named runtime exports, with aliases resolved to their original names.
  Namespace, default, side-effect, re-export and dynamic forms do not establish that boundary, nor do
  subpaths or missing compiler import facts. A package owned by an adapter stays that adapter's.
- **Why:** test registration and reporting are effects at an executable boundary, like application
  startup; they do not require declaring a framework pure or writing forwarding wrappers for its API.
  Callbacks retain runner authority, bodies stay checked, and shared comparisons can return plain
  data to entrypoint assertions. This selects top-level exports, not individual members of exported
  objects. It does not classify browser handles or a property-testing package's generation semantics.

## Not yet built

- `kit ledger`, `kit partition` and `kit rename`; only `kit check`, `kit refs` and `kit consumers` exist.
- Incremental extraction, which pre-commit use waits on.
- A published command and build: `scripts/kit-check.mjs` runs the TypeScript source through vite-node.
- Validation of the config: the runner reads roots, terms, claim separator, legacy areas and zones, ignored paths,
  adapters and packages. Other keys are ignored silently, and `layerNames` is not passed through from the config file.
- `kit partition`, choosing each test's environment from what its imports reach; harnesses that connect a
  contract to a real or a fake implementation; one contract suite run against both.
- Declared test-only observation hooks, with an undeclared hook as a finding.
- Per-zone compiler settings, so each zone compiles against only the APIs it may touch.
- App-declared state properties (persisted, session-only, undoable, replicated, event-sourced) and their checks.
- A roster that must equal the table under its term, entry for entry.
- The ledger and topic view: each module's placement, findings, debt and proofs, and a feature's topic footprint.
- A check that the Kit stays under a tenth of the code it governs.

## 2026-10-26 · Authority is structural: behaviour crosses only as a contract

- **Decision:** Kit no longer follows callables, closures and SDK handles across modules. Three rules replace
  that inference. The core and readings take data: an export there that takes a callable, an accessor or an
  object with operations is a finding, unless the position is typed as a registered adapter's contract or a port
  its operations return. Code outside the zones, legacy or a declared entrypoint, hands placed code only data or
  such a contract. Only an adapter constructs values of its contract and ports; a declared entrypoint may build
  test doubles. Behaviour moves freely only between the compositions and adapters of one zone, which share its
  permissions, and imports already keep zones apart. A package handle may be taken by the adapter that declares
  its package. `accepts`, `contract.parameter`, callable and closure bindings, and their capture facts are gone.
  This supersedes the 2026-10-17 entries on callable capture and same-file handle passing.
- **Why:** the inference had grown to most of Kit's code and claims, and every new language corner added more. An
  agent couldn't predict its findings without running it, and one legacy file could fail an unrelated placed
  module. A module's authority is now what its imports and the contract types in its signatures show, which is
  what the rules promised. The cost: a pure higher-order helper can't live in the core or a reading, and a fake
  of a contract lives in an entrypoint or is registered as its own adapter.

## 2026-10-26 · The README is the method on one page

- **Decision:** the README holds the why, the two-phase workflow, topics, the rules and setup. Configuration
  detail moved to `docs/reference.md`, the language-independent method to `docs/method.md`. The oracle adoption
  inventory taken at `83ffb2a` left the README: it recorded six legacy oracle modules, 91 statements and 21 calls,
  paid down to the cache fixture's 40 statements and six calls in `self-debt/legacy.json`.
- **Why:** an agent or a person adopting Kit should be able to hold the method in one read; edge cases belong
  where they are looked up.

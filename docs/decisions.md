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

## 2026-10-26 · Kit checks all of itself

- **Decision:** `scripts/` is a code root, and its launchers are declared entrypoints that hand a Kit command its
  arguments, working directory and input and write its answer. The ratchet, config parsing, snapshot cache,
  `kit refs`, `kit consumers` and the verification runner are placed modules with terms and claims. The source
  loader is a placed JavaScript adapter, since nothing could load it otherwise; a registration names a JavaScript
  module by its extension. The last legacy module, the cache fixture, is placed. Kit's baseline is empty and it
  reports no checker limits.
- **Why:** a checker whose own gate logic sits outside its rules can't show that the rules deliver what they
  promise. Moving the logic exposed real gaps the check then named: undeclared host globals, a `performance`
  clock outside an adapter, a loader handing callbacks to launchers, and commands no test reached because they
  ran only in a subprocess. Commands are now functions from a request to a response, proved in-process.
- **For apps:** `testRoots` moved to `src/core/readings/kit-configuration.ts`, and `verification` and
  `runVerification` to `src/substrate/compositions/verification-runner.mjs`.

## 2026-10-26 · Granularity is judged in plan review

- **Decision:** no rule measures whether a module is too coarse. When a claim names a module other claims
  already name, the phase-1 reviewer asks whether it needs the same code or a different part; a different part
  is a new module. `kit refs` shows the claims a module keeps.
- **Why:** every static measure tried on Kit failed without a size threshold. Claim cohesion can't see inside a
  single entry. Requiring claims to reach distinguishable parts of a module flagged 43 of the 46 modules named by
  more than one claim. Flagging a claim that reaches only part of a module flagged 40 small modules, a three-line
  one included, and missed the 982-line snapshot reader, which has one export. Which code a claim relies on can
  be measured, by mutation testing grouped by claim, but the machinery outweighs what it buys today.

## 2026-10-26 · #57 and #58 are superseded by structural authority

- **Decision:** the refinements #57 and #58 made to callable-binding inference (dynamic imports in captured
  code, accepted handles passed on, adapter-only reach) are not carried over, because that inference is gone:
  outside code hands placed code only data or a registered contract, and the core and readings take no
  behaviour. #57's dynamic-constructor cases are kept under `authority-is-derived`; its two forbidden-flow cases
  now expect `takes-behaviour` on the Core module. #58's two tests exercised `accepts`, which no longer exists.

## 2026-10-26 · A claim's tests reach only what it names

- **Decision:** `proof-scope` is the converse of `proof-reach`. A placed module a claim's tests reach without
  the claim naming it is debt. Modules of only types and the oracle's helpers need no name, though what a helper
  reaches counts as the test's. A named composition outside the oracle covers what it imports, so an end-to-end
  claim names the composition it is about. The debt is ratcheted, not a violation: a too-wide proof is imprecise
  evidence, not broken architecture. Apps can adopt it with their current breadth in the baseline, and a new
  claim starts exact.
- **Why:** 69 of Kit's 87 test files ran the whole pipeline, so every claim appeared to depend on about 40
  modules. That made `kit refs` and claim cohesion coarse, and nothing kept a test narrow.
- **How a proof narrows:** compile a fixture and record only what one recorder reads (`recorded-contracts`),
  build a snapshot of just those facts (`project-snapshot`), and call the one check the claim keeps. Helpers take
  data and return data, because a test may hand placed code no behaviour.

## 2026-10-26 · Every function is governed, and claims keep their excerpts apart

- **Decision:** `kit runs` records, per test, which named functions of each placed module it ran, from the app's
  own LCOV reports plus raw V8 coverage for processes the test starts. Two ratcheted rules read the record:
  every named function is run by a claim that names its module, and a module holding code only one claim runs,
  for two or more claims, is split along those claims. Code every claim runs is the shared core; a function held
  by shared code is part of it; adapters are exempt. Named functions are the grain: an anonymous function belongs
  to the one holding it, and both runners report named functions in source lines.
- **Why:** static reach can't see inside a function a test calls, so a god module behind one entry looked
  cohesive. What a claim's tests actually run can. Measured on Tuck, the rule flagged its operation table, its
  per-source page readers and its per-claim rules, and none of its widely shared modules; on Kit it flagged the
  config reader, now one reading per section. Completeness found 22 functions of `test-reach` that only Kit's
  end-to-end self-check ran, and five that nothing could reach, which were deleted.
- **Cost:** recording runs each test file in its own process: about 2 minutes for Tuck and 5 for Kit. The check
  itself stays static and fast.


## 2026-10-29 · A config declares only the keys Kit reads

- **Decision:** an unknown key at any level of a config is an error naming its full path, and every config error
  answers the command on stderr with exit code 1. `app` names the app. Apps' plain-Node scripts load the config
  readers through `configuration-runner.mjs`.
- **Why:** Kit ignored keys it didn't read, so an app could believe it had declared something Kit never
  enforced. Leeloo's config carried five such keys (`zones`, `tests`, `state`, `probe-port`, `trusted-base`)
  from an older Kit. A config error is not a finding because a baseline must never be able to hold it.
- **For apps:** delete keys Kit doesn't read; `kit consumers` names them. Scripts that imported the loaders
  removed in #59 import `configuration-runner.mjs`.

## 2026-10-29 · One runs record per test

- **Decision:** `kit runs` writes one record per test into the `runs.record` directory. A record holds what the
  test ran and the digest of every file it depends on: the test, the placed files its code reaches and the
  modules it ran. A check reads it while each digest holds and the test reaches nothing new; `--stale` records
  exactly the tests whose records don't, and named tests record alone.
- **Why:** the single record named every placed module and test, so any edit staled it whole, every agent
  rewrote one 325 KB file, and parallel work conflicted on it. Holding only the modules a test ran would miss
  an edit to a module it imports but never ran, such as a constant that turns on a branch, so the record holds
  its reach too.
- **Cost:** about 100 small committed files for Kit. Re-recording one test takes about 30 seconds, against about
  5 minutes for all of them.
- **For apps:** `runs.record` names a directory; delete the old file and run `kit runs`.

## 2026-10-29 · Facts are kept per file, keyed on what they depend on

- **Decision:** extraction stores each file's compiler facts and each test's reach in a store beside the
  repository, one file per key, and reuses an entry while its key matches. A file's key is its project's key and
  the content of every file its imports reach; a project's key is the Kit, the compiler, the config, the
  project's options, its declaration files, its files declaring globals and its registered adapters. `kit check
  --fresh` reads without the store. The whole-snapshot cache, its trace replay and `--fresh-compare` are gone,
  and each project's program is released once its facts are read.
- **Why:** the cache reused a snapshot only when nothing it read had changed, so any edit re-extracted the whole
  app, and on Leeloo the cache's single JSON string of the snapshot exceeded the default heap. Leeloo's four
  programs were all held to the end: 3.1 GB of heap after extraction, 1.1 GB once released. Keying on content
  rather than replaying reads makes a key a value, which worktrees share and a store can hold without an index.
- **The order rule:** the compiler orders a union's parts and a type's members by when it created them, which
  depends on what it checked first, so a file walked alone could record them differently from a full walk. Such
  lists are stored sorted, and an export's printed type, which no check read, is no longer recorded.
- **Measured on Kit:** `kit check` with nothing changed takes 1.6 s against 8 s; one edited leaf re-extracts 7
  files and 5 tests.

## 2026-10-29 · A pass is kept with what its run read

- **Decision:** `kit verify` runs the checks and tests an app declares under `verify`, each test file in its own
  process, with a preloaded recorder that notes every path inside the app the run reads, lists or probes,
  including in its threads and child processes. A pass is kept with the state of those paths, and reused while
  they all still hold.
- **Why:** a static key misses what a test reads that isn't a module, such as a config or a fixture, and on
  Leeloo the static closure of a test is a third of the app. Observing reads covers modules and data alike with
  no declarations, and is the rule the runs records already follow. Keeping one entry per distinct set of states
  lets two worktrees, or an edit and its revert, each keep theirs.
- **Measured on Kit (4 cores):** cold 172 s; nothing changed 1 s; one leaf edited, 14 of 103 checks rerun in
  33 s; the edit reverted, all reused in 0.08 s.
- **Not covered:** inputs no file holds (network, clock, environment variables). Each test runs in its own
  process, so a cold run costs more than one vitest run; folding `kit runs` into it is next.

## 2026-10-29 · A baseline is one file per finding path

- **Decision:** `kit check --baseline` may name a directory holding one file per finding path; a `.json` file is
  read as before. Kit's own baseline is `self-debt/legacy/`, empty.
- **Why:** Leeloo's single baseline held 3,244 keys in 1.2 MB, so every agent paying down debt edited one shared
  file, the conflict the runs record had. The baseline is a ledger of accepted debt, so only its storage changes:
  the ratchet reads the files as one record.

## 2026-10-29 · Facts key on what an import lends: its outline

- **Decision:** a file's facts key on its own content and on the outline of every file its imports reach: the
  text without the bodies of functions whose return type is declared. A test's reach still keys on content,
  since it follows bodies.
- **Why:** no recorder reads past another file's declarations except test reach, and a declared return type
  hides the body from every importer. Keying on full content made one edit to Leeloo's widely used
  `civil-date.ts` recompute 2,614 of 3,777 files' facts; a body-only edit now recomputes 4. The outline is
  syntax alone, so it is deterministic and cheap, unlike emitted declarations, which depend on options and on
  the order the compiler checked in.
- **Next:** test reach is now most of an edit's cost (1,524 of 1,857 reaches recomputed for that edit).

## 2026-10-29 · A test's reach holds while the files it followed hold

- **Decision:** a test's reach keys on the test and the outlines of what it imports, as facts do, and names
  each file whose code it followed, with that file's digest; it is reused only while each still has it.
- **Why:** keying on the content of the whole import closure recomputed a reach for an edit to a file the test
  imports but never follows. On Leeloo a body edit to a file of median use now recomputes 3 reaches instead of
  21, and an edit to the widely used `civil-date.ts` 1,246 instead of 1,524 (30 s instead of 42 s). Naming
  each body followed instead of each file was measured too: for a random body, the tests that follow it are
  nearly all the tests that follow its file, while the reach took three times as long.

## 2026-10-29 · One rule for what Kit keeps, and nothing kept in Git

- **Decision:** a gate result and a test's reach are each kept with the state of every path they were read
  from, one entry per set of states, and hold while each path still has its state. What a test ran is kept
  with its pass by `kit verify`, under the one test command, which writes coverage into `{dir}`; `kit check`
  reads it from the passes that still hold. The committed runs records, `kit runs`, the `runs` section and the
  earlier verification planner, partitioner, runner and declared-input keying are deleted.
- **Why:** committed runs records were most of every commit (102 of 113 files, 36 of 46, 35 of 42), so
  parallel agents would conflict on them, and they kept a second freshness rule. A reach kept under one key
  per test made two worktrees overwrite each other. Nothing launched the earlier planner once `kit verify`
  observed what each check reads.
- **Cost:** `kit check` alone on a fresh clone waits on the two rules that read what tests ran until `kit verify`
  has run once, and says so.

## 2026-10-29 · A pass holds while the code its test ran holds

- **Decision:** a file a test only loaded, whose functions its coverage lists, is kept as its text with the
  bodies of the outermost functions the test never ran left out; a path a check only probed is kept by its kind.
  A file also read as text is kept whole. `kit verify` runs a gate's checks 64 at a time and keeps each chunk's
  passes as it ends.
- **Why:** on Leeloo, file grain reruns every test that loaded an edited file. A preview over 950 of its 1,865
  test files, for one-line edits inside a function of a placed module: `civil-date.ts` 369 tests rerun at file
  grain, 90 by the functions run; `retrieval.ts` 139 to 2; `attachment-migration.ts` 113 to 7;
  `google-claims.ts` 110 to 6. Legacy files keep their own numbers until they are placed, which is the goal.
  The first cold run on Leeloo held every test's coverage until the end and ran out of memory after 69 minutes,
  keeping nothing; hence the chunks.
- **Limits:** a test that reads an unrun function's text through running code, such as
  `Function.prototype.toString`, is not seen. Leeloo's test workspace reads every test root's files when vitest
  starts, so under `kit verify` every test would depend on every file until it computes its tiers once.

## 2026-10-29 · Kit picks each test's group by what its imports reach

- **Decision:** `verify.tests` may list groups, each a command, its directories and optionally `reaching`, the
  modules whose reach selects it. A test runs in the first group whose modules its import closure reaches, else in
  the first that names none; a test no group takes is named and counted, not run. `kit check` makes the same
  choice to find each test's pass, through one core reading over the snapshot's import edges.
- **Why:** Leeloo chose a unit or browser tier in its test runner's workspace config, which read every file
  under every test root at each start, so under `kit verify` each test's pass would have depended on the whole
  tree. Kit already holds the import edges, and the group's command is part of what a pass is kept under, so a test
  that comes to reach a browser harness reruns under the browser command without anything reading more.
- **Evidence:** on Leeloo, with the two boot harnesses as `reaching`, Kit's unit group holds 1083 tests where the
  app's own rule holds 1073. Eleven are browser there only by an `e2e` name and reach neither boot harness; they
  drive a shared browser module instead, and naming it too takes all eleven but also six gate meta-tests that
  import the legacy workspace file, which imports it. One test goes the other way, through an import Kit's
  snapshot reads from a fixture string. No name-based selection was added: the app can name the module its e2e
  tests use once the workspace file is gone.

## 2026-10-29 · A test group may be selected by capability

- **Decision:** a group under `verify.tests` may list `capabilities` beside or instead of `reaching`. It takes a
  test whose import closure reaches a listed module or the module of an adapter registered with a listed
  capability; a group listing neither is the fallback, and the first group that takes a test still wins. A
  capability no adapter registers fails configuration, naming the entry. The adapters' modules are resolved to
  files by the same placement the capability rules use, and `kit verify` and `kit check` hand them to one core
  reading as data.
- **Why:** Leeloo's browser tier is the tests that drive the browser, and which module does that is already a
  registration: the adapter with the browser-driving capability. Listing harness files under `reaching` has to
  follow every new harness, and a browser test that imports the driver from a new place would otherwise land in
  the unit group. Naming the capability keeps the tier where the design decision already lives.

## 2026-10-29 · Compiler reads are no longer recorded

- **Decision:** the compiler adapter reads through the compiler's own system and records nothing. Extraction keeps
  only the filesystem reads it takes file digests from.
- **Why:** the record served the snapshot cache's trace replay, which is gone, yet every resolution probe was
  still kept to the end of the run. On Leeloo with its packages installed that was 646,000 entries, 120 MB of
  heap at the peak. A cold `kit check` now peaks at 2,387 MB of live heap, from at least 2,512 MB (which ran out
  of memory under a 2,560 MB heap), and takes 225 s instead of 238 s.
- **Limits:** a cold check of Leeloo still needs about 2.5 GB of heap; with nothing changed it needs under 2 GB.
  Its main project checked by `tsc` alone holds 1.9 GB, and Kit's walk, diagnostics and test reaches use the
  same checker on top of what earlier projects left, so fitting 2 GB means reading a project in more than one
  program.

## 2026-10-29 · Passes are shared through refs on origin

- **Decision:** with `verify.share` declared, `kit verify` reads the passes on `origin`'s refs
  `<share>/<day>-<runtime>` for today and yesterday into the local store before planning, and afterwards adds
  every pass it kept or reused to today's ref as one commit pushed without force; a lost race reads again and
  adds on top. Failing to share is reported and never fails the gate. Kit's own config does not declare it yet.
- **Why:** each agent's cloud session starts with an empty store beside its clone and paid a full cold run. A
  ref on `origin` reaches every lane with nothing but git, and Leeloo's `test-cache` refs already run this
  protocol: anyone with push access may publish, and a nightly `kit verify --fresh` is the honesty check. A
  pass's path names its command, runtime and the states it holds, so racing writers converge. Republishing the
  passes a run reused keeps a day's ref whole, so reading two days is enough.

## 2026-10-29 · What a kept pass depends on is recorded more completely

- **Decision:** after an independent review of `kit verify`'s reuse, the recorder and the keys tighten:
  - a directory listing is dropped only when the test runner's own frames (vite, vite-node, vitest) make it; any
    other installed package's listing, such as `tsc` expanding `include`, is recorded. The app root's own
    listing is recorded as `.`; recursive listings, globs (`fs.glob*`) and copies (`cp*`, `copyFile*`) record
    every directory under them, copies every file too; `readlink*`, `statfs*`, `realpath.native` and
    `promises.opendir` are recorded. The caller frame is read from call sites with a stack depth the recorder
    sets itself, so a check's `Error.stackTraceLimit` no longer turns its reads into loads.
  - a file a process other than the one that loaded the test loaded, or whose raw V8 coverage another process
    wrote, is kept whole instead of as the functions the test's LCOV shows ran.
  - a pass is not kept when a file it used changed after its chunk started, by the file system's own clock,
    so a cold run catches an edit during the run too. Directories are left to the comparison with earlier
    passes' states: their time also moves for an entry made and removed again, as Vite does with the
    `vitest.config.ts.timestamp-*.mjs` it bundles beside the config, which made every check listing the root torn.
  - a pass's kind holds the Kit's source digest when Kit reads the app from outside it, and the runtime holds
    the app root's `package.json`. `NODE_OPTIONS` is extended, not replaced.
  - project-wide diagnostics are keyed also on each compiler config's text and the compiled file list; the
    project key leaves out `verify` and `app`, which extraction never reads.
  - the docs recommend `share: refs/kit-passes`, and a reading of shared refs removes the clone's mirrors of
    other refs under the same prefix.
- **Recorder format:** lines stay `<use> <path>` in one file per process and thread, `<pid>-<thread>.txt`; the
  pid in the file name is now read, to tell which process loaded the test. New are the path `.` for the app
  root, and many more `list` lines, one per directory a recursive listing, glob or copy reaches. A batched
  runner that runs several tests in one process needs another way to tell a test's process from a child's.
- **Why:** each of these let a pass be reused after an edit that could change its result: a new file under a
  `tsc` include, a child process running a function the parent's coverage shows unrun, a file edited while a
  cold run read it, or a Kit upgrade. Recording more listings means adding a file reruns the checks that list its
  directory, which is the price of their being right.
- **Limits:** on a run with no earlier pass, an entry added to a listed directory while the check ran is not
  caught. Reads by programs that aren't Node, by processes started with an environment that drops the
  recorder, and Node's own loader reads below the app root and failed resolutions are still unseen.

## 2026-10-29 · A group may run its tests in one runner

- **Decision:** a test group whose command takes `{tests}` instead of `{test}` runs each chunk of up to 64 due
  tests in one vitest 1.x invocation, `--pool=forks --poolOptions.forks.isolate=true`, with Kit's coverage
  provider `{provider}` writing into `{dir}` each test file's result, LCOV report and the scripts it executed.
  The recorder in each process vitest starts reads the file it runs from vitest's message to it, under `files`,
  and names it in its recording (`test <path>`) and in those of the processes it starts (`under <path>`), whose
  raw V8 coverage goes to a directory of the test's own. A test keeps its own processes' uses, the runner
  process's reads, listings and probes except those of another test of the invocation, the files its coverage
  shows it executed as loads, and the runner's other loads. What a process the test started loaded or ran is
  kept whole. A failing test fails alone; a test whose attribution is unclear runs again alone, which is a
  `{test}` run. A pass is kept under the command as it reads for one file, so either mode reuses the other's.
  Kit's own gate now runs this way.
- **Why:** each vitest start costs about 4 s, so Leeloo's 1,865 test files took over an hour cold on 4 cores.
  The runner's main process transforms every module for every fork and caches it, so its loads can't be told
  apart by process; the coverage of each fork names every module it executed, which is the same set.
- **Measured on Leeloo (104 unit tests under `src/core/`, `oracle/command-bindings/`, `oracle/fields/`, 4
  cores, other agents' runs holding the load average at 9 to 13):** cold `kit verify` 548 s per file, 177 s
  batched, none run again alone. Every pass holds the same paths by content and the same states, and the same
  `ran`, in both modes; a batched pass also holds the kind of about 340 more paths (median 2,032 kind keys)
  that the runner probed resolving other tests' imports. Body edits to `retrieve`, `matchExcerpt` and
  `structuralSprigs` in `src/core/readings/retrieval.ts` plan the same reruns in both modes (1, 0 and 0), as
  does a top-level edit (3). Kit's own cold gate, batched, took 420 s under the same load.
- **Limits:** creating or deleting a file at a path the runner probed for a batch-mate reruns a batched pass,
  since resolution is cached across a run and can't be given to one test; edits to content never do. A test that
  imports another test file runs alone. The provider extends `@vitest/coverage-v8` through its 1.x provider
  interface and the recorder reads vitest 1.x's worker message, so `{tests}` is tied to vitest 1.x; `{test}`
  works with any runner.

## 2026-10-30 · Every module defines something

- **Decision:** a module whose statements only re-export, beside imports whose every binding it exports again,
  is a forwarder, and each is the finding `R2:forwarder:<path>`: a violation when placed, legacy debt
  otherwise, with a fix naming the modules it re-exports. Declaration files and declared entrypoints are
  exempt, so a package's public index is declared rather than flagged. Whether a file only forwards is
  recorded with its size during the fact walk, resolved by the compiler, so it is stored and reused with the
  file's other facts.
- **Why:** a forwarder hides the real edge, since its importers appear to depend on the shim, and it is the
  shape a dodge of the dependency rules takes. The first app's own scan for "every module defines something"
  found one left behind by a module split. The promise belongs in Kit, so every app gets it and that app can
  retire its own scan. As legacy debt, an adopting app's existing forwarders go in its baseline, and a migration
  can't add one without the baseline growing.

## 2026-10-30 · A comment a test only loaded doesn't rerun it

- **Decision:** a file a test only loaded, kept by the functions it ran, is kept by its code: the tokens the
  TypeScript scanner reads, each with whether a line break comes before it, and the comments a tool reads, with
  unrun bodies left out as before. A comment counts when its text starts with `@`, `#`, `!` or `/`, or with a
  coverage hint (`node:coverage`, `c8`, `istanbul`, `v8`), and in a JavaScript file every `/**` comment counts.
  A file a test reads as text is still kept by its content.
- **Why:** a comment edit inside a function a test ran changed the file's kept text, so explaining code reran
  every test that ran it. Leeloo plans comment-only source edits as it plans prose edits and wants them as cheap.
  The parser's tokens, not a pattern, tell a comment from a string or template holding `//`, and a regular
  expression from a division. Directives, pure annotations, source maps, licenses and coverage hints change what a
  tool does, so they stay; JSDoc in JavaScript is the types a check of JavaScript reads, and always keeping it
  saves reading the app's compiler settings. A line break stays because it changes where a semicolon is inserted.
- **Limits:** a test that reads a comment through the running code, such as `Function.prototype.toString`, isn't
  seen, as an unrun body never was. Line numbers shift with a removed comment, but coverage lines are read only
  when a pass is kept, against the text it ran. Whitespace between JSX elements is left out; whitespace inside
  JSX text counts. Passes kept before this change hold another digest and run once.

## 2026-10-30 · Function bodies stay within a declared limit

- **Decision:** with `limits.functionLines` declared, each named function whose body spans more lines is the
  finding `R3:function-size:<path>:<function>`, keyed by the id the function recorder gives it: a violation when
  placed, legacy debt otherwise, whose baseline entry records its lines so it may shrink but never grow. A body's
  lines are its physical span, from its opening line to its closing line, blank and comment lines included, and
  that span holds every function inside it, so an anonymous closure, or a named one, counts toward its holder.
  Tests are not measured. The span is recorded with the named functions during the fact walk, so it is stored
  and reused with the file's other facts. Kit declares no default limit.
- **Why:** a body too long to hold at once is read in pieces, and the first app's own guard held its bodies to
  120 lines. Kit counts the way that guard does, so its number carries over: the span is what a reader has to
  hold, and it needs no judgement about which lines are code. A statement count, as legacy size uses, would
  resist formatting but drift from the app's number; formatting inside one function moves little, and the
  ratchet only asks that a legacy function not grow. The app chose 120 from a gap in its own code, between its
  largest ordinary body and its smallest offender, so it is that app's number rather than a default for every
  app, and an undeclared limit measures nothing. A legacy function's size is a ratchet like a legacy module's,
  in lines instead of statements, kept apart so each fails with its own fix.

## 2026-10-30 · Paid debt fails until tightened, and an entry may say why it is owed

- **Decision:** a baseline entry whose debt is paid fails `kit check` with the fix "Run `kit check --tighten` to
  drop paid debt.": a key no legacy or proof debt finding holds, and a `legacy-size` entry recording more than
  its module now holds. An entry is paid exactly when tightening would change it, so `--tighten` always clears
  the failure, and a check run with `--tighten` judges the baseline it leaves. Each paid entry is its own line,
  `<key>: <fix>`, like every other failure: the key says which baseline file to look at, and the consumer report
  already reads failures that way; the fix is one command however many lines there are. An entry may carry a
  `reason` beside its value; tightening keeps it and `--report` shows it. A reason is never required.
- **Why:** a paid key left in the baseline would let the same debt come back unnoticed, and a recorded size
  larger than the module would let it grow back to that size. Leeloo's own debt lists already fail on a stale
  entry and make each entry name what drains it. A required reason fits lists kept by hand; a baseline written
  once from thousands of findings can't carry one per key, so a reason is optional and only checked to be text.
- **Transition:** an app whose baseline holds paid keys or larger sizes fails on the first check after
  upgrading, each line naming the key and the command. Running `kit check --tighten` once, and committing the
  baseline it leaves, makes the check pass; nothing else changes, and baselines without reasons read as before.


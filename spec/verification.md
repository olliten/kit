# Verification

An app declares the checks its gate requires. `kit verify` runs them and keeps each pass with what its run read,
so a later gate runs only what an edit can have changed.

## The gate

- The bounded proof runner executes the supplied Vitest test filters, execution and coverage options in one
  run, with the governed root given by the caller. It loads no application configuration, discovered workspace,
  environment file or PostCSS configuration: its workspace and PostCSS plugins are explicitly empty. Requests
  to load configuration or a workspace, watch, or start a browser or UI are rejected; application journeys keep
  their declared runner. Its exit status reports the actual run, including failures and unhandled errors.
  · {#the-proof-runner-has-bounded-inputs}
  - Implementation: {{proof-runner}}, {{proof-run}}
  - Proof: {{temporary-project}}, {{processes}}, {{module-doubles}}

- A test group may declare the runtime `contexts` its proofs require, as distinct lowercase names using
  letters, digits and hyphens. The command identity includes those names. Each required context is captured
  for that test in `<name>-context.json`; missing or incomplete capture grants no independent execution
  credit even when the Node test process completed. `KIT_CONTEXTS` gives the command those names separated
  by commas, and `KIT_COVERAGE`, `KIT_RUNTIME` and `KIT_TEST` identify its report directory, runtime and proof.
  Each test's encoded report directory exists before execution. `KIT_FUNCTIONS` names the supplied original
  named-function facts, including source offsets; mapped proof machinery reads the corresponding original
  source bytes so its evidence holds the sources that establish those identities.
  · {#required-runtime-contexts-are-captured}
  - Implementation: {{verification-configuration}}, {{verify-run}}, {{check-run}}, {{execution-context}}
  - Proof: {{temporary-project}}

- An app declares its gate under `verify`: whole-tree checks, each an id and one command, optionally run after
  the tests, and its tests as one group or a list of groups, each the command that runs one test file `{test}`,
  which may also write the test's coverage into `{dir}`, or several test files `{tests}` with Kit's coverage
  provider `{provider}` writing into `{dir}`, for every test under one or more relative directories, and
  optionally the modules inside the app and the capabilities of registered adapters whose reach selects it, and
  optionally `share`, the ref prefix on `origin` its passes are shared under, and `capacity`, how much runs at
  once. A check may name the checks it `needs`, and a group its own `capacity`. A malformed declaration, or group,
  a capacity that is no positive whole number, a need no declared check meets, one of a check run with the tests
  on a check run after them, or needs in a cycle, or a capability no adapter registers fails configuration naming
  where, and `kit verify` without one says what to declare. Groups may have distinct nonblank `id` values;
  unnamed groups retain their ordinary classification. · {#the-gate-is-declared}
  - Implementation: {{verification-configuration}}, {{kit-configuration}}, {{config-schema}}, {{verify-run}}
  - Proof: {{temporary-project}}
- A test runs under the command of the first group, in declared order, whose directories hold it and whose
  modules its imports reach, directly or through the files they import, where a group's modules are those it
  names and the modules of the adapters registered with a capability it names, and otherwise of the first such
  group that names neither. `kit check` reads each test's pass under the command the same choice gives it, so a
  test that comes to reach another group's module runs again under that group's command. A test no group takes
  is not run, and `kit verify` names it, counts it and fails. · {#tests-run-in-the-group-their-reach-selects}
  - Implementation: {{test-groups}}, {{verify-run}}, {{check-run}}, {{verification-configuration}}, {{kit-configuration}}, {{read-snapshot}}
  - Proof: {{temporary-project}}
- A recorder preloaded into a check's processes, added to the Node options the caller's environment gives, records
  every path inside the app the check reads, lists, probes, copies or loads, the app root itself as `.`, in its
  own process, its worker threads and the processes it starts, nothing of the repository's own bookkeeping, and
  of installed packages only the package each path under `node_modules` falls in, except a Kit installed among
  them, whose files it records as the app's. A recursive listing, a glob or a copy of a directory lists every
  directory under it, and a copy reads every file. A load is a read only the module loader made, Node's own or the
  test runner's, or npm's own of a package manifest; any other code's read is a read, whatever stack trace limit
  it set. A directory listing the test runner makes, such as finding its tests, is not recorded; one any other
  installed package makes, such as a compiler expanding its configuration's globs, is. A path that spells the
  root's own location inside the root, as a resolver asking whether the root holds itself does, is recorded with
  that location as the mark `#root`, which names wherever the app is, so a recording names no folder. Loaded
  without being asked to record, it changes nothing. · {#reads-are-observed}
  - Implementation: {{read-recorder}}, {{verdict-reuse}}, {{verify-run}}, {{processes}}
  - Proof: {{temporary-project}}, {{processes}}
- `kit verify` keeps a passing check with the state of every path its run used: a file's content or a
  directory's listing for a path it read or listed, and only whether it is absent, a file or a directory for a
  path it only probed. It reuses the check while each path is still in that state, under the same command,
  runtime and recording format, and runs the rest together; a failure is never kept, a pass during which a path it read changed, from a state
  an earlier pass kept, or a file it read since its run started, is reported and not kept, and runs on different trees each keep
  theirs. A check declared
  `after: tests` runs once the tests' passes are kept, and is not kept itself when a test's pass was not. Its
  reuse also holds the exact invocation evidence input but the root's location: runtime and scripts, and each test's
  command, held states, named functions and attributable execution context. That input omits elapsed time;
  durations remain diagnostic data in the persistent passes. Serialization orders its identities and offers
  only those fields. `--plan` can reuse an after-test check only when every selected test already has a valid
  pass establishing that same input; otherwise it plans to run the check.
  `--fresh` reuses and keeps nothing persistently, but supplies its own passing test evidence to checks run
  after tests. Their command may use `{evidence}` for this invocation's evidence file; `kit check --evidence`
  validates its format, governed root, runtime, expected test commands and held states before granting credit.
  A changed input invalidates evidence and is counted separately from intentionally unpersisted evidence.
  `--plan` says what would run, and it exits 1 when a check fails. A pass holds a tree, not a folder: the same
  tree verified in another folder that shares the store, such as another worktree of the repository, reuses
  every pass and keeps no new one. · {#verdicts-hold-while-their-reads-hold}
  - Implementation: {{verify-run}}, {{check-run}}, {{invocation-evidence}}, {{invocation-passes}}, {{verdict-reuse}}, {{verdict}}, {{evidence-store}}, {{filesystem}}, {{toolchain}}, {{processes}}, {{read-recorder}}, {{stopwatch}}, {{text-files}}
  - Proof: {{temporary-project}}
- A pass is kept under the recording format, a version Kit declares and changes only when how a pass's states,
  a script's ran code or their digests are recorded changes, never under Kit's source as a whole: a release of a
  Kit, under the same format, reuses every pass that used none of its files. A Kit installed among the app's
  packages is recorded as the app's own files are, so a check whose processes read or loaded one of its files,
  other than the recorder and coverage provider it runs under, such as a check that runs `kit check` or a test
  whose configuration imports Kit, holds that file's state, and a release reruns only the passes whose runs used a
  file it changed. A Kit outside the app, whose files no recording names, is held whole instead: a check whose
  processes loaded its code holds its pass while that Kit's source is the same. · {#passes-are-kept-under-the-recording-format}
  - Implementation: {{verdict-reuse}}, {{verify-run}}, {{held-state}}, {{read-recorder}}, {{toolchain}}
  - Proof: {{temporary-project}}
- A pass holds the installed packages its run used, not the lockfile whole: a path under `node_modules` is
  recorded as the package it falls in, the path up to the name after its last `node_modules`, with the scope of a
  scoped one, and the pass holds that package's entry in `package-lock.json`, its version, resolved source,
  integrity and link, or that it has none, and every path the lockfile installs that name at, so installing it
  nearer an importer is seen. An install that changes a package the run used reruns it, and one that changes only
  others reuses it; a lockfile only the module loader read, as Vite does to key its own cache, is held through
  those packages alone. A check is kept under the runtime: Node's version, platform and architecture, and the
  app's Node loader fields (`name`, `main`, `type`, `imports`, `exports`), including their order where the
  resolver uses it. A command running package scripts through `npm`, `yarn`, `pnpm`, `bun` or `node --run` also
  holds the scripts, so a script edit reruns only those. A manifest read as resolver metadata retains its
  non-script metadata and dependency names and categories. When the resolved package graph is tracked,
  changing only dependency version declarations does not invalidate a pass whose used packages stayed the
  same. An explicit manifest read or JSON import as data holds its whole content; an unknown role does too.
  With no lockfile, or one without a `packages` map, the runtime holds the lockfile whole instead. A package
  changed without a read the recorder sees, such as a native library a binding opens, a file it fetched outside
  the app, a package linked from outside the app, a name first installed where an import that found nothing
  looked, or files installed otherwise than their lockfile entry says, is not seen. · {#passes-hold-the-packages-they-read}
  - Implementation: {{read-recorder}}, {{verdict-reuse}}, {{held-state}}, {{toolchain}}, {{verify-run}}
  - Proof: {{temporary-project}}
- `kit verify --selection <file>` validates a versioned selection against the digest of every discovered test
  identity before running it. Unknown or duplicate selected tests, a stale inventory, an empty policy identity,
  or a discovered test no group takes fail even when the test is deferred. Whole-tree checks still run. The
  result names the discovered, selected and deferred tests, selection policy and verification scope; a deferred
  test receives no pass. Without a selection, all discovered tests are selected. Selected verification prints
  `Kit verify null` before its `Kit selection` result. The null clears any earlier exhaustive summary a nested
  command printed for an older consumer; it is no full verification evidence. Selected counts never occupy
  the exhaustive summary, so an exhaustive consumer cannot mistake partial evidence for a full pass.
  `kit verify --defer-group <id>` selects the complete complement of one declared group using the same
  discovery and import-based classification. Every other group's tests, including unnamed groups, and all
  whole-tree and after-test checks remain required. Unknown group IDs, repeated selectors or combining
  group deferral with an explicit selection fail. Its partial result declares SDK-derived
  `selectionKind: deferred-groups`, `deferredGroups`, policy `deferred-group/<encoded-id>/1` with the ID
  URI-encoded, and the selected/deferred identities; a caller's
  explicit selection policy cannot supply those fields. With no selector, verification remains exhaustive.
  · {#a-selection-names-what-it-defers}
  - Implementation: {{selection}}, {{verification-selection}}, {{verify-run}}, {{test-groups}}, {{fact-keys}}
  - Proof: {{deferred-group-fixture}}, {{temporary-project}}, {{processes}}, {{text-files}}
- A script a test only loaded, whose functions the test's coverage lists, is kept as the test ran it: its code
  with the body of every outermost function the test never ran left out, where a function counts as run when a
  function the coverage shows ran starts inside it. Its code is its tokens as the language's scanner reads them,
  each with whether a line break comes before it, and the comments a tool reads: one whose text starts with `@`,
  `#`, `!` or `/`, such as `@ts-expect-error`, `#__PURE__`, `# sourceMappingURL`, a license header or a
  triple-slash directive, one starting with a coverage hint (`node:coverage`, `c8`, `istanbul`, `v8`), and in a
  JavaScript file every `/**` comment, whose types a check of JavaScript reads. The pass holds while that code is
  the same, so an edit inside a function the test never ran, or one that only changes another comment or
  whitespace, reruns nothing, and an edit to code it ran, to a string, to the module's top level, or to which
  functions the file has reruns it. A file the test also reads as text is kept whole, comments and all, and so is
  a file another process than the one that loaded the test loaded or ran, such as a child the test starts, whose
  run the test's coverage need not show. A test that reads an unrun function's text, or a comment, through the
  running code, such as `Function.prototype.toString`, is not seen. · {#a-pass-holds-while-the-code-it-ran-holds}
  - Implementation: {{verify-run}}, {{held-state}}, {{ran-code}}, {{function-span}}, {{code-token}}, {{coverage-report}}, {{compiler}}, {{read-recorder}}, {{verdict-reuse}}, {{text-files}}, {{filesystem}}
  - Proof: {{temporary-project}}
- Within one `kit verify`, a kept key's state is read once for each version of its path, however many passes
  plan to hold or keep it, and a script's functions once for each version, however many tests' coverage lists
  it. A version is the path's device, inode, size, and modification and change times, trusted only once it
  changed before the file system's clock last moved past the start of the plan or round reading it, since an
  edit within the same tick can leave all of them the same; a path changed since is read each time, so an edit
  during the run is always seen. The summary counts the states read and those reused. · {#a-state-is-read-once-per-version}
  - Implementation: {{verify-run}}, {{held-state}}, {{filesystem}}
  - Proof: {{temporary-project}}
- A group whose command takes `{tests}` runs a chunk's due tests in one invocation of vitest 1.x, with a fresh
  process per test file and Kit's provider writing each file's result, coverage and executed scripts apart; a
  test's pass is kept under the command as it reads for that file alone. Each test's encoded-path directory
  under `{dir}` may contain several LCOV reports, whose execution evidence is combined only for that test;
  sibling directories and chunk-wide reports grant it no execution credit. A recording is a test's when its process
  learned from the runner's first message naming it among the files that process runs that it runs that test
  alone, or was started by such a process; the runner's own reads, listings and probes are every test's but
  those it made of another test of the invocation, and a file it loaded is each test's that executed it, or every
  test's when none did. A file a process the test's process started loaded or ran is kept whole. A failing test
  fails alone and leaves the others kept; a test whose process ran another test file, whose coverage holds
  another, or whose invocation failed without a test failing or with unhandled errors, runs again alone. The
  provider depends on vitest 1.x's coverage provider interface and worker message; `{test}` serves any
  runner. · {#a-group-runs-its-tests-in-one-runner}
  - Implementation: {{verify-run}}, {{batch-attribution}}, {{coverage-provider}}, {{read-recorder}}
  - Proof: {{temporary-project}}
- `kit verify` runs its commands within a capacity, the machine's parallelism unless `verify` declares one: a
  whole-tree check or a test its group runs alone takes one of it, and a chunk, up to 64 of a group's due tests
  that its `{tests}` command runs in one invocation over several processes, takes half of it, or all of a capacity
  of one, so a chunk starts while another finishes and no more than two run at once. A group's `capacity` bounds
  how many of its commands run at once, such as one for tests that share a browser. A command starts as soon as it
  fits, in order: a chunk, the checks, then the other chunks, the groups' in turn; a test run again alone starts
  before them, and a check that `needs` others once each has passed or was reused, and, unless its own pass is
  reused, fails without running when one failed. Each command records into a directory of its own, so its reads
  are attributed as if nothing else ran; a chunk's passes are kept, and shared, once it and the tests it runs
  again alone have ended, whatever else runs, and a failing command loses no other's pass. The output, the summary
  and `--plan` are the same however the commands overlapped. · {#commands-run-within-a-capacity}
  - Implementation: {{verify-run}}, {{command-schedule}}, {{verification-configuration}}, {{processes}}
  - Proof: {{temporary-project}}
- With `share` declared, a pass is shared through `origin`: one ref per runtime and UTC day,
  `<share>/<day>-<runtime>` with the runtime's digest cut to 16 characters, whose tree holds each kept pass at
  `verdicts/<kind>/<key>.json` as the store holds it. Before planning, `kit verify` reads today's and yesterday's
  ref and keeps each pass there the store lacks, so a pass another clone kept is reused like its own; once each
  chunk's passes are kept it adds to today's ref every pass it kept or reused that the ref lacks, as one commit on
  the tip pushed without force, so a run stopped after a chunk has shared what it kept. A push refused because the tip moved reads the ref again and adds on top, a few times; a
  pass already at a path stays. No origin, no network, a refused push or a lost race is said in the output, the
  run publishes nothing more and goes on with its own store, so sharing never fails the gate; the summary counts what was read and
  published. A reading removes the clone's copies of every other ref beside the two it reads. `--plan` reads and does not publish, and `--fresh` and `--no-share` neither read nor publish. · {#passes-are-shared-through-refs}
  - Implementation: {{pass-sharing}}, {{shared-passes}}, {{git-refs}}, {{calendar}}, {{verify-run}}, {{evidence-store}}, {{toolchain}}, {{verification-configuration}}
  - Proof: {{temporary-project}}

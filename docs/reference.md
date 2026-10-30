# Reference

What `kit/config.md` can declare beyond the basics in the README, and the portable tools Kit ships. The spec in
`spec/` says what holds; this page says how to ask for it.

## Keys

A config's YAML fence declares only these keys. Any other key, at any level, is an error that names it, such as
`adapters[3].globalz`. Every config error answers the command on stderr with exit code 1, naming the file.

| Key | What it declares |
| --- | --- |
| `app` | The app's name, as Kit's output names it. |
| `roots.src`, `roots.spec`, `roots.oracle` | The code roots (one path or a list), the specification root and the proof root. |
| `terms` | The terms file; `spec/terms.md` when absent. |
| `claim-separator` | The text that separates a claim's promise from its anchor, such as `·`. |
| `ignore` | Relative paths the walk never lists or reads; an import into one is an error. |
| `exceptions` | Exact executable entrypoints outside every zone. |
| `packages` | Package contracts: `name`, `capabilities`, and optionally `entrypointExports`. |
| `adapters` | Adapter registrations: `module`, `export`, `capability`, `kind`, `zones`, and optionally `contract.type`, `primitives`, `globals`, `packages`. |
| `dependency-exclusions` | Separations of local code: `from`, `to`, `imports`, `reach`. |
| `layout.legacy` | Existing code outside the code roots, kept as location debt. |
| `legacy-zones` | Rows of `zone` with either a `root` or a list of `files`, never both. |
| `legacy-areas` | Spec files in an older claim grammar. |
| `legacy-test-roots` | Test directories discovery still includes beside the proof root. |
| `verify.checks`, `verify.tests` | The gate `kit verify` runs: whole-tree checks, each an `id` and a `command`, and the tests: one group, or a list of groups each taking the tests whose imports reach a module it lists in `reaching` or a module an adapter registers with a capability it lists in `capabilities`, or with neither the tests no earlier group took; a group is the `command` that runs one test file `{test}`, optionally writing its coverage into `{dir}`, for every test `under` a directory or a list of them. |
| `verify.share` | A ref prefix on `origin`, such as `refs/kit-passes`, under which `kit verify` shares kept passes with every other clone. |

An app's plain-Node scripts read the config the way the commands do through
`src/substrate/compositions/configuration-runner.mjs`: `await configuration()` answers `kitConfig`,
`configuredKit` and `testRoots`.

## Claims as table rows

A claim may be a table row. Each data row is one claim, with its anchor closing the final cell:

```markdown
| Command | What it does | Available when |
| --- | --- | --- |
| Decline | Saves the reviewer's reason. | An article is open. · {#decline-needs-reason} |
```

All cells together state the claim and contribute their references. The same anchor binds the same proof file
whether the claim is a list item or a row. Optional `Implementation` and `Proof` columns hold comma-separated
module references; an empty cell omits that relationship. Headers declare no claims.

`Implementation` names modules providing the claimed behaviour; `Proof` names reusable machinery used to establish
it, such as shared generators, reference models or drivers. Each row appears at most once and lists distinct
references. The claim test is the outer proof entrypoint: it registers cases, wires modules and asserts results.

## Several code roots

To govern shared test modules too, list the code roots:

```yaml
roots:
  src: [src, oracle]
  spec: spec
  oracle: oracle
```

Each code root uses the same zones and layers. Module identities then include the root, for example
`oracle/core/primitives/decline-cases`, and adapter registrations use those identities. Term names stay globally
unique. `roots.oracle` still selects claim proof files.

## Adapters

```yaml
adapters:
  - module: substrate/adapters/journal
    export: journal
    capability: journal
    kind: external          # or produce / apply, for write descriptions
    zones: [substrate]
    contract: {type: Journal}
    globals: [fetch]        # host globals only this adapter may use
    packages: [some-sdk]    # packages only this adapter may import; their handles may be passed to it
    primitives: [clock]     # clock or randomness sampled here
```

The contract type and every port its operations return are the only behaviour the core and readings may take,
and only the adapter's file constructs their values.

## Entrypoints

An exact file outside every zone may wire Shell and Substrate contracts, such as an application's startup or a
claim test:

```yaml
exceptions:
  - oracle/review-an-article/decline-needs-reason.test.ts
```

It keeps its topic binding and is checked for authority and compiler failures. No module may import it, its
dependencies gain no permission, and its violations can't be waived as legacy debt. It may construct test
doubles of a contract. For direct test registration, a package contract can select named runtime exports:

```yaml
packages:
  - name: vitest
    capabilities: [test-runner]
    entrypointExports: [test, expect]
```

This is available only in exact declared entrypoints. Aliases and type-only imports are supported; namespace
imports, dynamic imports, re-exports and package subpaths stay unresolved. A package owned by an adapter still
belongs to that adapter.

## Forwarders

A module whose statements only re-export, through `export … from`, `export * from` or an imported binding
exported again, beside imports whose every binding it exports again, defines nothing: its importers seem to
depend on it rather than on the modules that do the work. Each is one finding, `R2:forwarder:<path>`, under
every code root and legacy location, whose fix names the modules it re-exports:

```text
R2:forwarder:src/core/readings/sum.ts: Point each importer at the module it uses (src/core/readings/total.ts) and delete this forwarder.
```

A placed forwarder is a violation no baseline waives. A legacy one is debt: an app adopting Kit baselines the
forwarders it has, and a forwarder added later, such as one a split leaves behind, has no key there and fails.
A module that also declares anything, a type included, keeps an imported binding for itself or runs anything,
a bare `import "./x.js"` included, is not a forwarder, and neither is an empty one. Declaration files are not
read for it, and a declared entrypoint is exempt, so a package's public `index.ts` barrel stays a forwarder
only until it is listed under `exceptions`.

## Dependency exclusions

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

Selectors name existing files or directories, without patterns. The first rule forbids direct production imports
of oracle code, including types. The second follows runtime dependencies through helpers and re-exports to keep a
reference model separate from the implementation it judges. Erased type contracts remain allowed. Transitive
checks retain uncertainty at opaque boundaries. Direct checks also use an ambient module's single declaration
home, such as Node built-in declarations; several homes retain uncertainty.

## Legacy

- `layout: {legacy: [...]}`: existing code outside the code roots, kept in extraction, authority and size
  accounting as location debt. Declaring a layout also checks that source, tests and specs sit in their roots.
- `legacy-zones`: the zone a legacy prefix, or an exact list of legacy files, actually belongs to, so imports
  across placement keep zone boundaries.
- A baseline is `kit check --baseline <path>`: a file ending `.json` holding every debt key, or a directory such as
  `kit/debt/legacy/` holding one file per finding path, named by the path with `/` replaced by `+`. A directory
  lets agents paying down debt on different modules edit different files; `--tighten` rewrites only the files
  whose keys changed and removes emptied ones. To move a single file into a directory, write each finding path's
  keys to its own file and delete the old one.
- `legacy-areas`: spec files in an older format, outside the topic shape until they gain Implementation rows.
- `legacy-test-roots`: test directories the runner should still discover; read by `testRoots()`, which apps
  load through the configuration runner.
- A `legacy-zones` row:

  ```yaml
  legacy-zones:
    - { root: src/client/, zone: shell }
    - { files: [src/boot.ts], zone: substrate }
  ```

## Verify

```yaml
verify:
  checks:
    - id: typecheck
      command: npx tsc --noEmit -p tsconfig.json
    - id: check
      command: node scripts/kit-check.mjs
      after: tests
  tests:
    command: npx vitest run {test} --coverage.enabled --coverage.all=false --coverage.provider=v8 --coverage.reporter=lcovonly --coverage.reportOnFailure --coverage.reportsDirectory={dir}
    under: oracle/
```

`kit verify` runs each check, and each test file under `under` alone, in parallel, with a recorder preloaded
through `NODE_OPTIONS`, added to whatever the caller's environment sets there, that notes every path inside the
app the run reads, lists, probes or copies, in the run's processes, threads and child processes. The app root's
own listing is the path `.`; a recursive listing, a glob or a copy of a directory notes every directory under
it. A pass is kept beside the repository with the state of each of those paths, under the command, the Node
version, the lockfile and the app's `package.json`, and, when Kit reads the app from outside it, that Kit's own
source; the next `kit verify` reuses it while every path is in the same state. A failure is never kept, and
neither is a pass during which a path it used changed. Worktrees of one repository share what is kept.

What the recorder can't see, a reused check must not depend on:

- reads by programs that aren't Node, such as `git`, `grep` or a shell's globbing;
- reads by a Node process started with an environment that drops `NODE_OPTIONS`, `KIT_READS` or `KIT_ROOT`;
- what Node's own module loader reads to resolve a module, such as a `package.json` below the app root, and
  the paths a resolution tried and didn't find. The app root's `package.json` is part of what a pass is kept
  under, so its `type`, `exports` and `imports` are covered.

Directory listings the test runner makes itself, such as vitest finding its test files, are not noted; a listing
any other installed package makes, such as `tsc` expanding `include`, is.

The tests may instead be a list of groups, each with its own command, such as a browser tier and a unit tier:

```yaml
  tests:
    - command: npx vitest run --config browser.config.ts {test}
      under: [oracle/, spec/]
      reaching: [spec/harness/full-stack.ts]
    - command: npx vitest run {test}
      under: [oracle/, spec/]
```

A test runs in the first group whose `under` holds it and whose `reaching` lists a module its imports reach,
directly or through the files they import, and otherwise in the first group whose `under` holds it that lists
none. A module is named by its path inside the app, with or without its extension.

A group may instead, or as well, list `capabilities`: it then also takes the tests whose imports reach the module
of any `adapters` row registered with one of them, so a new test that drives the browser adapter lands in the
browser group wherever it lives, without its harness files being listed:

```yaml
  tests:
    - command: npx vitest run --config browser.config.ts {test}
      under: [oracle/, spec/]
      capabilities: [browser]
    - command: npx vitest run {test}
      under: [oracle/, spec/]
```

A group listing both takes a test that reaches either. A capability no adapter row registers fails
configuration, naming the entry, such as `verify.tests[0].capabilities[1]`. The imports are those `kit
check` reads, type-only ones included, so the choice is Kit's own and reads no test runner's configuration.
Since the command is part of what a pass is kept under, a test that comes to reach another group's module runs
again, and `kit check` looks for each test's pass under the command the same choice gives it. A test no group
takes is not run: `kit verify` prints `unassigned test:<path>` and counts it in its summary, and `--plan` names
each test's group as `in tests[<index>]`. The rules that read what tests ran apply when every group's command
writes coverage.

A path a run only probed is kept by whether it is absent, a file or a directory. A file a test only loaded, and
whose functions its coverage lists, is kept as the test ran it: its text with the bodies of the outermost
functions the test never ran left out, so an edit inside one of those reruns nothing. A file the test also reads
as text, as a test of a checker reads its sources, is kept whole, and so is a file a process other than the one
that loaded the test loaded or ran, such as a script the test starts: an in-process runner's coverage, such as
vitest's, doesn't show what such a process ran.

### Several tests in one runner

Starting a test runner costs seconds per test file. With vitest 1.x, a group whose command takes `{tests}`
instead of `{test}` runs each chunk of its due tests, up to 64, in one invocation, with a fresh process per file
and Kit's coverage provider writing each file's result and coverage apart:

```yaml
  tests:
    command: npx vitest run --pool=forks --poolOptions.forks.isolate=true {tests} --coverage.enabled --coverage.all=false --coverage.provider=custom --coverage.customProviderModule={provider} --coverage.reporter=lcovonly --coverage.reportOnFailure --coverage.reportsDirectory={dir}
    under: oracle/
```

Kit replaces `{provider}` with its provider's path, which extends `@vitest/coverage-v8` as installed beside Kit, so
the app installs it. A test's pass is kept under the command as it reads for that file alone, so a pass kept in a batch
is reused by a run of the file alone and the other way round.

Each pass stays as precise as a run of its file alone. The recorder in each process vitest starts for a file
learns which file from vitest's message to it and names it in its recording, and in those of the processes it
starts, so the test's own reads are its alone. What the runner's main process reads, lists or probes is kept by
every test of the invocation, except a use of another test file it was given; a file it loads, such as a module
it transforms, is kept by each test whose coverage shows it executed that file, and by every test when none did.
A file a process the test started loaded or ran is kept whole, since the test's coverage doesn't describe that
process. A failing test fails alone and the others are kept. A test whose coverage also holds another test file,
as when it imports one, or whose process ran several files, runs again alone, as every test of an invocation
does when it failed without a test failing or with unhandled errors; the summary counts them as `alone`.

The provider uses vitest 1.x's coverage provider interface and its worker message, so it is tied to that
version; `{test}` works with any runner.

## Runs

When the test command writes the test's LCOV report into `{dir}`, `kit verify` replaces `{dir}` with a directory
of the test's own and sets `NODE_V8_COVERAGE`, so processes the test starts count too, and keeps with each
test's pass the named functions of each placed module it ran. With vitest, that is the command above, with
`@vitest/coverage-v8` installed; `--coverage.all=false` keeps coverage from reading every source file, which
would make each test's pass depend on the whole tree. With `node --test`, it is `node --test
--experimental-test-coverage --test-reporter=lcov --test-reporter-destination={dir}/lcov.info {test}`.

`kit check` reads what each test under the proof root ran from its pass while it still holds. Nothing is
committed. While any such test has no pass that holds, the two rules that read what tests ran wait, and the
check says how many tests they wait for; `kit verify` runs `kit check` after the tests, so the gate always has
them. Their findings are debt that may only shrink:

- `ungoverned-function`: a named function no test of a claim naming its module runs.
- `excerpt-cohesion`: a module holding, for two or more claims, code that only that claim runs and that no
  code other claims run holds. Adapters are exempt.

A check with `after: tests`, such as `kit check`, runs once the tests' passes are kept, and is not kept itself
when a test's pass was not.

## Sharing passes

```yaml
verify:
  share: refs/kit-passes
```

Any ref prefix under `refs/` works. One outside `refs/heads/` keeps the shared refs from looking like branches
and from starting the workflows that run on a pushed branch.

With `share`, clones that start with an empty store, such as agents' cloud sessions, reuse each other's passes
through `origin`. Each runtime and UTC day has one ref, `<share>/<YYYY-MM-DD>-<runtime digest, 16 characters>`,
whose tree holds each pass at `verdicts/<kind>/<key>.json`, the text the local store holds. Before planning,
`kit verify` fetches today's and yesterday's ref and keeps every pass the local store lacks; a file that is not
a pass kept under its own key is ignored. After the run it adds every pass it kept or reused that today's ref
lacks, as one commit on the tip pushed without force, so a day's ref holds the passes still in use. A push the
remote refuses because the tip moved reads the ref again and adds on top, up to four times; a path already
there stays. No `origin`, no network or a push refused for another reason is said on its own line, `Shared no
passes:` or `Published no passes:`, and the gate goes on with the local store. The summary counts `shared:
{read, published}`. `--plan` reads and never publishes; `--fresh` and `--no-share` neither read nor publish.

Anyone who can push to `origin` can publish a pass, so a shared pass is as trustworthy as the people with push
access; a scheduled `kit verify --fresh` checks that every kept pass still passes. The refs only grow within a
day, and old days' refs are never read again: delete them on `origin` as you like. A clone's own copies of
them, under `refs/kit-shared/`, are removed by its next reading.

`kit verify --plan` lists what would run, `--fresh` runs everything and keeps nothing, and the exit code is 1
when a check fails. A check that depends on something no file holds, such as the network, the clock or an
environment variable, should not be a reused check.

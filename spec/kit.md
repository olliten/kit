# Kit

The Kit is built in its own structure and checks itself. It names no app concept: an app's layout lives in
its config, and its debt in its own baseline.

## Reading an app

- A root declaration the checks do not support is an error, never an ignored root; configuration
  accepts only the supported root fields and shapes. `roots.src` accepts one code-root path or a set of
  paths, checked together in one snapshot and graph; extraction, authority, structural checks, references
  and debt accounting cover every selected code root. The spec and proof roots remain single paths. · {#declared-roots-are-checked}
  - Implementation: {{kit-configuration}}, {{config-values}}, {{read-snapshot}}, {{capability-check}}, {{name-check}}, {{comment-check}}, {{module-references}}, {{proof-reach}}, {{placement-of}}, {{term-model}}, {{legacy-size}}, {{ratchet}}, {{line-ratchet}}
  - Proof: {{fixture-snapshot}}, {{source-fixture}}

- A configuration declares only the keys Kit reads. An unknown key at any level is an error naming its full
  path, such as `adapters[3].globalz`, and every configuration error, in the YAML, a section or a row, answers
  the command on stderr with exit code 1: never a finding a baseline could hold, never a stack trace. `app`
  names the app in Kit's output. · {#config-keys-are-known}
  - Implementation: {{config-schema}}, {{kit-configuration}}, {{config-values}}, {{legacy-zone-configuration}}, {{read-config}}, {{check-run}}, {{command}}
  - Proof: {{temporary-project}}

- An app's plain-Node script loads the Kit configuration and its test roots through the configuration runner,
  without a build, and reads the values the commands read. · {#apps-load-the-config-from-plain-node}
  - Implementation: {{configuration-runner}}, {{kit-configuration}}, {{test-roots}}, {{source-loader}}

- An app switches a rule off only by declaring it, with its reason: under `rules`, the rule's name maps to
  `off` and why, as nonempty text. Only the rules that read what tests ran, `ungoverned-function` and
  `excerpt-cohesion`, may be switched off; another rule's name, another key, or a missing or empty reason is a
  configuration error naming its key. A rule switched off reports no finding, so its baseline keys are paid.
  The authority rules `native-authority` and `ambient-global` may instead be scoped to production code, as
  `tests: off` with a nonempty `reason`: the rule then reports nothing on a file Kit reads as a test, one named
  `<name>.test.<extension>`, and everything it did on every other file; a value other than `off`, a
  missing key or reason, or another key is a configuration error naming its key.
  While those rules wait for tests with no kept pass, their baseline keys are left as they are: not paid, and
  not dropped by tightening. · {#a-rule-is-switched-off-by-declaration}
  - Implementation: {{rule-switch}}, {{kit-configuration}}, {{config-schema}}, {{gate}}, {{check-run}}, {{paid-debt}}, {{ratchet}}
  - Proof: {{temporary-project}}, {{recorded-functions}}, {{project-snapshot}}, {{recorded-authority}}

- Test discovery includes the configured proof root and only explicitly configured
  `legacy-test-roots`, with no application directory names built in. Each is a relative directory
  without patterns or dot segments; invalid declarations fail instead of dropping proofs. Legacy
  discovery grants no placement or capability permission. · {#proof-discovery-is-configured}
  - Implementation: {{test-roots}}, {{config-values}}

- An app may opt into directory roles with `layout: { legacy: [...] }`. Source and shared proof code
  belong in its governed code roots, tests in its proof root, and Markdown in its specification root
  rather than code roots. The proof root is one governed code root; the specification root is separate.
  Other Markdown and non-code assets are not specifications merely by existing in the repository.
  Exact relative legacy files or directories retain their misplaced files as location debt; new location
  debt fails the ratchet. Missing or malformed legacy locations fail configuration. Legacy locations
  grant no module placement, capability or executable-entrypoint permission. Without a layout declaration,
  existing configuration keeps its behavior. · {#directory-roles-are-configured}
  - Implementation: {{layout-check}}, {{kit-configuration}}, {{layout-configuration}}, {{legacy-size}}, {{placement-of}}, {{ratchet}}, {{line-ratchet}}, {{read-snapshot}}
  - Proof: {{source-fixture}}

- {{read-snapshot}} reads an app on disk, the tally example with violations planted in a copy, as its files,
  imports, claims, terms and references through {{filesystem}} and {{compiler}}, and the check finds exactly the
  planted findings ({{snapshot}}, {{file}}). · {#read-snapshot-fixture}
  - Implementation: {{dependency-check}}, {{name-check}}, {{comment-check}}, {{module-references}}, {{claim-proof-binder}}
  - Proof: {{binding-findings}}, {{temporary-project}}, {{text-files}}
- The real snapshot reader discovers every case input it is given, and readings over that data run without
  changing it ({{read-snapshot}}). · {#readings-use-data}
  - Proof: {{case-inventory}}, {{source-loader}}, {{capability-app}}, {{temporary-project}}
- A file's compiler facts and a test's reach are stored under a key of what they depend on. A file's facts
  depend on its own content and on the outline of every file its imports reach: its text without the bodies of
  functions whose return type it declares, which no importer can see. A test's reach is keyed the same way on the
  test, and is kept with the digest of each file whose code it followed, one entry per set of digests, and
  reused only while each still has its digest. Each key also holds what Kit takes each file for, and
  the project, which is the Kit that read it, the
  compiler, the config without its gate and the app's name, the project's options, every declaration file the program loads, every file declaring
  globals or ambient modules, and the registered adapter modules. What belongs to no one file, such as the config's own errors, is also keyed on
  the text of every compiler config the project reads and the files it compiles. A read reuses every file and test whose key
  still matches and computes the rest, so a change recomputes exactly the files and tests whose key it
  changes, and worktrees of one repository share the store. · {#facts-are-keyed-on-their-inputs}
  - Implementation: {{fact-keys}}, {{file-facts}}, {{project-facts}}, {{read-snapshot}}, {{evidence-store}}, {{root-token}}, {{fact-walk}}, {{compiler}}, {{verdict-reuse}}
  - Proof: {{extraction-proof}}, {{small-app}}, {{temporary-project}}
- A read through the store equals a read without it, as a snapshot and in its findings, after any sequence of
  edits: the compiler's member and union order, which depends on what it checked first, is never kept. `kit
  check --fresh` reads without the store, and an entry the store can't read is computed again. · {#stored-equals-fresh}
  - Implementation: {{project-facts}}, {{read-snapshot}}, {{check-run}}, {{evidence-store}}, {{toolchain}}, {{stopwatch}}
  - Proof: {{extraction-proof}}, {{small-app}}, {{snapshot-comparison}}
- A path the config ignores is never listed or read by {{read-snapshot}}, and an import into it is an error,
  never a missing edge. · {#ignored-paths-are-unread}
  - Implementation: {{kit-configuration}}, {{read-snapshot}}, {{ignored-import}}
  - Proof: {{small-app}}, {{temporary-project}}
- `kit refs` lists the claims that name a module, each with its topic and tests; as a read hook it adds that
  list to what an agent sees when it opens the module, and adds nothing for any other file. · {#refs-list-a-modules-claims}
  - Implementation: {{refs-description}}, {{refs-run}}, {{text-files}}, {{source-loader}}, {{terminal-input}}
  - Proof: {{temporary-project}}, {{processes}}
- `kit consumers <app>…` checks each app checkout against this Kit, with the app's own config and baseline, and
  lists per app the findings that would fail it, grouped by check, beside the Kit commit the app pins, or the
  config error when this Kit does not accept the app's config; an app that fails does not fail the run. · {#consumers-show-each-apps-work}
  - Implementation: {{consumer-report}}, {{consumers-run}}, {{processes}}
- Paths given to `kit check` resolve against the directory it runs in; with none, the Kit checks itself. A
  launcher in `scripts/` hands its command the arguments, working directory and input, and answers the terminal
  with the command's output and exit status. Unless the caller set a heap size, a command runs with a heap of at
  least 4 GB, since a first read of a large app holds the compiler's checked program, near 2 GB for some apps on
  its own. · {#paths-from-the-caller}
  - Implementation: {{check-paths}}, {{config-values}}, {{source-loader}}
  - Proof: {{temporary-project}}, {{processes}}, {{text-files}}

## Checking itself

- Source fixtures own separate temporary directories, write supplied relative paths only inside their
  directory with the declared compiler settings and roots, and dispose the directory on return or
  failure. A recorded fixture compiles its files and records only what one recorder reads, so a proof need not
  read a whole snapshot: its checked sources are the code files and the entrypoints, claim proofs among them, its
  directory is gone before it returns, and recorders of the same files share one compilation. A fixture that
  doesn't compile is an error. · {#source-fixtures-own-their-files}
  - Implementation: {{source-fixture}}, {{program-fixture}}, {{fixture-files}}, {{temporary-project}}, {{fact-walk}}, {{read-snapshot}}, {{compiler}}
  - Proof: {{recorded-authority}}, {{recorded-contracts}}, {{recorded-escapes}}, {{recorded-imports}}, {{recorded-terms}}

- Kit's production source is placed and its imports obey the dependency rules; its claims, modules and
  tests bind with no finding, claims that share no code share no module, its placed modules bind to terms without supporting-word terms, its terms
  are defined once, its names and prose use no retired word, and its comments cite nothing and carry no
  debt. These checks use one snapshot of the actual configured repository. · {#kit-checks-itself}
  - Implementation: {{claim-cohesion}}, {{comment-check}}, {{dependency-check}}, {{gate}}, {{kit-configuration}}, {{name-check}}, {{placement-of}}, {{proof-reach}}, {{read-snapshot}}, {{term-model}}
  - Proof: {{binding-findings}}
- Each app under `examples/` is an example Kit governs like any other app: it declares its own `kit/config.md`
  and an empty `kit/debt/legacy.json`, and `kit check` passes on it, so an example can't drift from the rules
  it shows. A deliberate violation lives in the proof that needs it, never in an example. · {#examples-pass-their-check}
  - Implementation: {{check-run}}
  - Proof: {{text-files}}

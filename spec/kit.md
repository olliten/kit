# Kit

The Kit is built in its own structure and checks itself. It names no app concept: an app's layout lives in
its config, and its debt in its own baseline.

## Reading an app

- A root declaration the checks do not support is an error, never an ignored root; configuration
  accepts only the supported root fields and shapes. `roots.src` accepts one code-root path or a set of
  paths, checked together in one snapshot and graph; extraction, authority, structural checks, references
  and debt accounting cover every selected code root. The spec and proof roots remain single paths. · {#declared-roots-are-checked}
  - Implementation: {{kit-configuration}}, {{config-values}}, {{read-snapshot}}, {{capability-check}}, {{name-check}}, {{comment-check}}, {{module-references}}, {{proof-reach}}, {{placement-of}}, {{term-model}}, {{legacy-size}}, {{ratchet}}
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
  - Implementation: {{layout-check}}, {{kit-configuration}}, {{layout-configuration}}, {{legacy-size}}, {{placement-of}}, {{ratchet}}, {{read-snapshot}}
  - Proof: {{source-fixture}}

- {{read-snapshot}} reads an app on disk, the tally example with violations planted in a copy, as its files,
  imports, claims, terms and references through {{filesystem}} and {{compiler}}, and the check finds exactly the
  planted findings ({{snapshot}}, {{file}}). · {#read-snapshot-fixture}
  - Implementation: {{dependency-check}}, {{name-check}}, {{comment-check}}, {{module-references}}, {{claim-proof-binder}}
  - Proof: {{binding-findings}}, {{temporary-project}}, {{text-files}}
- The real snapshot reader discovers every case input it is given, and readings over that data run without
  changing it ({{read-snapshot}}). · {#readings-use-data}
  - Proof: {{case-inventory}}, {{source-loader}}, {{capability-app}}, {{temporary-project}}
- A file's compiler facts and a test's reach are stored under a key of what they depend on: the file and every
  file its imports reach, with what Kit takes each for, and its project, which is the Kit that read it, the
  compiler, the config, the project's options, every declaration file the program loads, every file declaring
  globals or ambient modules, and the registered adapter modules. A read reuses every file and test whose key
  still matches and computes the rest, so a change recomputes exactly the files and tests whose key it
  changes, and worktrees of one repository share the store. · {#facts-are-keyed-on-their-inputs}
  - Implementation: {{fact-keys}}, {{file-facts}}, {{project-facts}}, {{read-snapshot}}, {{evidence-store}}, {{root-token}}, {{fact-walk}}, {{compiler}}
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
  with the command's output and exit status. · {#paths-from-the-caller}
  - Implementation: {{check-paths}}, {{config-values}}
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

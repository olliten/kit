# Verification

An app declares the checks its gate requires. `kit verify` runs them and keeps each pass with what its run read,
so a later gate runs only what an edit can have changed.

## The gate

- An app declares its gate under `verify`: whole-tree checks, each an id and one command, optionally run after
  the tests, and its tests as one group or a list of groups, each the command that runs one test file `{test}`,
  which may also write the test's coverage into `{dir}`, for every test under one or more relative
  directories, and optionally the modules inside the app whose reach selects it. A malformed declaration, or
  group, fails configuration naming where, and `kit verify` without one says what to declare. · {#the-gate-is-declared}
  - Implementation: {{verification-configuration}}, {{kit-configuration}}, {{config-schema}}, {{verify-run}}
  - Proof: {{temporary-project}}
- A test runs under the command of the first group, in declared order, whose directories hold it and whose
  modules its imports reach, directly or through the files they import, and otherwise of the first such group
  that names no modules. `kit check` reads each test's pass under the command the same choice gives it, so a
  test that comes to reach another group's module runs again under that group's command. A test no group takes
  is not run, and `kit verify` names it and counts it. · {#tests-run-in-the-group-their-reach-selects}
  - Implementation: {{test-groups}}, {{verify-run}}, {{check-run}}, {{verification-configuration}}, {{read-snapshot}}
  - Proof: {{temporary-project}}
- A recorder preloaded into a check's processes records every path inside the app the check reads, lists,
  probes or loads, in its own process, its worker threads and the processes it starts, and nothing under
  installed packages or the repository's own bookkeeping. A load is a read only the module loader made, Node's
  own or the test runner's; any other code's read is a read. A directory listing an installed package makes, such
  as a test runner finding its tests, is the runner's and is not recorded. Loaded without being asked to record,
  it changes nothing. · {#reads-are-observed}
  - Implementation: {{read-recorder}}, {{verdict-reuse}}
  - Proof: {{temporary-project}}, {{processes}}
- `kit verify` keeps a passing check with the state of every path its run used: a file's content or a
  directory's listing for a path it read or listed, and only whether it is absent, a file or a directory for a
  path it only probed. It reuses the check while each path is still in that state, under the same command,
  runtime and installed packages, and runs the rest together; a failure is never kept, a pass during which a
  path it read changed is reported and not kept, and runs on different trees each keep theirs. A check declared
  `after: tests` runs once the tests' passes are kept, and is not kept itself when a test's pass was not.
  `--fresh` reuses and keeps nothing, `--plan` says what would run, and it exits 1 when a check fails. · {#verdicts-hold-while-their-reads-hold}
  - Implementation: {{verify-run}}, {{verdict-reuse}}, {{verdict}}, {{evidence-store}}, {{filesystem}}, {{toolchain}}, {{processes}}, {{read-recorder}}, {{stopwatch}}, {{text-files}}
  - Proof: {{temporary-project}}
- A file a test only loaded, whose functions the test's coverage lists, is kept as the test ran it: its text with
  the body of every outermost function the test never ran left out, where a function counts as run when a
  function the coverage shows ran starts inside it. The pass holds while that text is the same, so an edit inside
  a function the test never ran reruns nothing, and an edit to code it ran, to the module's top level, or to
  which functions the file has reruns it. A file the test also reads as text is kept whole. A test that reads an
  unrun function's text through the running code, such as `Function.prototype.toString`, is not seen. · {#a-pass-holds-while-the-code-it-ran-holds}
  - Implementation: {{verify-run}}, {{held-state}}, {{ran-code}}, {{function-span}}, {{coverage-report}}, {{compiler}}, {{read-recorder}}, {{verdict-reuse}}, {{text-files}}, {{filesystem}}
  - Proof: {{temporary-project}}

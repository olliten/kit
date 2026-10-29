# Verification

A policy names the checks it requires. Checks declare their inputs, execution contract, strength,
prerequisites and resource needs, so evidence reuse and execution can be planned independently.

## Evidence

- Declared file inputs key the named data and code separately, with an explicit format and runtime identity.
  File bytes and suffix-filtered trees include additions and removals; a presence declaration keys only a
  path's absent, file or directory kind. Resolution follows symbolic links and preserves binary bytes;
  unreadable inputs fail instead of producing a key. Declaration order and checkout location do not change
  the key ({{declared-input}}, {{declared-input-files}}). · {#declared-inputs-determine-the-key}
  - Proof: {{temporary-project}}
- A result satisfies a required check only when its identity, inputs and execution contract match, it passed,
  and its strength meets the requirement. Unknown inputs and a policy requiring fresh execution reuse
  nothing ({{verification}}, {{verification-plan}}). · {#evidence-matches-inputs}

## Execution

- A check starts only after its prerequisites pass and capacity is available. Independent checks may run
  together; a failure blocks its dependants while unrelated checks finish. Missing prerequisites, repeated
  identities and cycles are rejected before execution ({{verification-plan}}, {{verification-runner}},
  {{source-loader}}). · {#scheduling-follows-dependencies}
  - Proof: {{scripted-verification}}
- Partitioning assigns every required check to exactly one worker, independently of discovery order. Resource
  labels and supplied durations affect placement, never the required checks or their verdicts
  ({{verification-partition}}). · {#partitions-cover-required-checks}

## The gate

- An app declares its gate under `verify`: whole-tree checks, each an id and one command, and the command that
  runs one test file `{test}`, for every test under a relative directory. A malformed declaration fails
  configuration, and `kit verify` without one says what to declare. · {#the-gate-is-declared}
  - Implementation: {{verification-configuration}}, {{kit-configuration}}, {{config-schema}}, {{verify-run}}
  - Proof: {{temporary-project}}
- A recorder preloaded into a check's processes records every path inside the app the check reads, lists or
  probes, in its own process, its worker threads and the processes it starts, and nothing under installed
  packages or the repository's own bookkeeping. Loaded without being asked to record, it changes nothing. · {#reads-are-observed}
  - Implementation: {{read-recorder}}, {{verdict-reuse}}
  - Proof: {{temporary-project}}, {{processes}}
- `kit verify` keeps a passing check with the state of every path its run read: nothing, a file's content or a
  directory's listing. It reuses the check while each path is still in that state, under the same command,
  runtime and installed packages, and runs the rest together; a failure is never kept, a pass during which a
  path it read changed is reported and not kept, and runs on different trees each keep theirs. `--fresh` reuses
  and keeps nothing, `--plan` says what would run, and it exits 1 when a check fails. · {#verdicts-hold-while-their-reads-hold}
  - Implementation: {{verify-run}}, {{verdict-reuse}}, {{verdict}}, {{evidence-store}}, {{filesystem}}, {{toolchain}}, {{processes}}, {{read-recorder}}, {{stopwatch}}, {{text-files}}
  - Proof: {{temporary-project}}

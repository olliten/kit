# Verification

A policy names the checks it requires. Checks declare their inputs, execution contract, strength,
prerequisites and resource needs, so evidence reuse and execution can be planned independently.

## Evidence

- Declared file inputs key the named data and code separately, with an explicit format and runtime identity.
  File bytes and suffix-filtered trees include additions and removals; a presence declaration keys only a
  path's absent, file or directory kind. Resolution follows symbolic links and preserves binary bytes;
  unreadable inputs fail instead of producing a key. Declaration order and checkout location do not change
  the key ({{declared-input}}, {{declared-input-files}}). · {#declared-inputs-determine-the-key}
- A result satisfies a required check only when its identity, inputs and execution contract match, it passed,
  and its strength meets the requirement. Unknown inputs and a policy requiring fresh execution reuse
  nothing ({{verification}}, {{verification-plan}}). · {#evidence-matches-inputs}

## Execution

- A check starts only after its prerequisites pass and capacity is available. Independent checks may run
  together; a failure blocks its dependants while unrelated checks finish. Missing prerequisites, repeated
  identities and cycles are rejected before execution ({{verification-plan}}, {{verification-runner}},
  {{source-loader}}). · {#scheduling-follows-dependencies}
- Partitioning assigns every required check to exactly one worker, independently of discovery order. Resource
  labels and supplied durations affect placement, never the required checks or their verdicts
  ({{verification-partition}}). · {#partitions-cover-required-checks}

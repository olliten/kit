# Convergence

Existing code reaches the structure one module at a time. Every finding has a key, findings in legacy code
and its size are debt that may only shrink, and placed code is held to every rule.

## Findings

- A finding carries its rule, path and fix, and a debt key made of rule, check, path and detail
  ({{finding}}). · {#finding-debt-key}
- The check rejects new legacy debt, every placed violation and every checker limit reachable through imports
  from placed code or a declared startup file; a baseline can't waive the last two ({{finding}}). · {#ratchet-keeps-architecture-obligations}
- A legacy zone row may list exact legacy files instead of a prefix: only those files take its zone, a new file
  beside them takes none, and each listed file is debt, so the row may shrink but a file added to it is new debt
  the ratchet rejects; a listed path that is placed or missing is a finding ({{capability-check}}, {{finding}}). · {#legacy-zone-rows-only-shrink}
- A legacy module's size is debt that may only shrink. A change may add at most a few statements to a legacy
  module, and only calls into placed modules; anything larger is placed first ({{legacy-size}},
  {{read-snapshot}}, {{finding}}). · {#legacy-does-not-grow}

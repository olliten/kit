# Convergence

Existing code reaches the structure one module at a time. Every finding has a key, findings in legacy code
are debt that may only shrink, and placed code is held to every rule.

## Findings

- A finding carries its rule, path and fix, and a debt key made of rule, check, path and detail
  ({{finding}}). · {#finding-debt-key}
- The check rejects new legacy debt, every placed violation and every checker limit reachable from placed
  code through its imports; a baseline can't waive the last two ({{finding}}). · {#ratchet-keeps-architecture-obligations}

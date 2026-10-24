# Convergence

Existing code reaches the structure one module at a time. Every finding has a key, findings in legacy code
and its size are debt that may only shrink, and placed code is held to every rule.

## Findings

- Configured legacy code locations remain in extraction, authority and size accounting without becoming
  module roots or acquiring layers. Existing unplaced code inside a target root remains ordinary debt;
  location debt and architectural debt drain independently. Neither a legacy location nor its baseline
  can waive a placed violation or reachable checker limit. · {#legacy-locations-stay-under-the-ratchet}
  - Implementation: {{layout-check}}, {{legacy-size}}, {{capability-check}}, {{placement-of}}, {{read-snapshot}}
  - Proof: {{source-fixture}}

- A finding carries its rule, path and fix, and a debt key made of rule, check, path and detail
  ({{finding}}). · {#finding-debt-key}
- The check rejects new legacy debt, every violation in placed code or an entry a host lists,
  and every checker limit reachable through imports from either; a baseline can't waive the last two
  ({{finding}}). · {#ratchet-keeps-architecture-obligations}
  - Proof: {{source-fixture}}
- A legacy zone row may list exact legacy files instead of a prefix: only those files take its zone, a new file
  beside them takes none, and each listed file is debt, so the row may shrink but a file added to it is new debt
  the ratchet rejects; a listed path that is placed or missing is a finding ({{capability-check}}, {{finding}}). · {#legacy-zone-rows-only-shrink}
  - Proof: {{source-fixture}}
- A legacy module's size is debt that may only shrink. A change may add no statement to a legacy module, not
  even a call into a placed module; new code is placed first ({{legacy-size}}, {{read-snapshot}},
  {{finding}}). · {#legacy-does-not-grow}
  - Proof: {{source-fixture}}

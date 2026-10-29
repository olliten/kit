# Convergence

Existing code reaches the structure one module at a time. Every finding has a key, findings in legacy code
and its size are debt that may only shrink, and placed code is held to every rule.

## Findings

- Configured legacy code locations remain in extraction, authority and size accounting without becoming
  module roots or acquiring layers. Existing unplaced code inside a target root remains ordinary debt;
  location debt and architectural debt drain independently. Neither a legacy location nor its baseline
  can waive a placed violation or reachable checker limit. · {#legacy-locations-stay-under-the-ratchet}
  - Implementation: {{layout-check}}, {{legacy-size}}, {{capability-context}}, {{placement-of}}, {{read-snapshot}}, {{source-size}}, {{access-authority}}, {{authority-graph}}, {{zone-authority-check}}, {{zone-permission}}, {{ratchet}}
  - Proof: {{source-fixture}}

- A finding carries its rule, path and fix, and a debt key made of rule, check, path and detail
  ({{finding}}). · {#finding-debt-key}
- The check rejects new legacy debt, every violation in placed code or a declared executable entrypoint,
  and every checker limit reachable through imports from either; a baseline can't waive the last two,
  except as a proof's debt ({{finding}}, {{ratchet}}). · {#ratchet-keeps-architecture-obligations}
  - Implementation: {{startup-check}}, {{capability-context}}, {{access-authority}}, {{global-authority}}, {{import-authority}}, {{edge-check}}, {{dependency-check}}, {{authority-graph}}, {{zone-authority-check}}, {{zone-permission}}, {{placement-of}}, {{read-snapshot}}, {{gate}}
  - Proof: {{source-fixture}}, {{fixture-snapshot}}
- A legacy zone row may list exact legacy files instead of a prefix: only those files take its zone, a new file
  beside them takes none, and each listed file is debt, so the row may shrink but a file added to it is new debt
  the ratchet rejects; a listed path that is placed or missing is a finding ({{registration-check}}, {{capability-context}}, {{finding}}). · {#legacy-zone-rows-only-shrink}
  - Implementation: {{edge-check}}, {{dependency-check}}, {{ratchet}}, {{import-recorder}}, {{fact-walk}}, {{compiler}}, {{legacy-zone-configuration}}, {{config-values}}
  - Proof: {{recorded-imports}}, {{project-snapshot}}
- Code outside the zones, legacy or a declared entrypoint, hands placed code data or a registered adapter's
  contract, never other behaviour. Its runtime import of a placed export that takes a callable, an accessor or
  an object with operations, through a parameter, a writable property or a mutable collection, is a finding
  keyed by the importer and the export: debt in legacy code, a violation in an entrypoint. A type-only import
  is none. · {#outside-code-hands-placed-code-data}
  - Implementation: {{handover-check}}, {{import-recorder}}, {{fact-walk}}, {{compiler}}, {{finding}}, {{ratchet}}
  - Proof: {{recorded-imports}}, {{project-snapshot}}
- A claim proof's own violations, and the checker limits reachable only through proofs, are debt keyed by the
  proof: the baseline holds them, they may only shrink, and a new proof starts exact. A limit also reachable
  from placed code or a declared entrypoint stays an obligation no baseline waives, so a proof's debt never
  covers the code it proves. · {#proofs-converge-under-the-ratchet}
  - Implementation: {{ratchet}}, {{capability-context}}, {{placement-of}}, {{finding}}
  - Proof: {{source-fixture}}
- A legacy module's size is debt that may only shrink. A change may add to a legacy module only statements
  that call into placed modules; new code is placed first ({{legacy-size}}, {{source-size}},
  {{finding}}, {{ratchet}}, {{check-run}}, {{command}}). · {#legacy-does-not-grow}
  - Proof: {{source-fixture}}
- A baseline may be a directory holding one file per finding path, each with the debt keys and sizes of the
  findings on that path, read together as one record; a baseline file ending `.json` is read whole as before.
  Tightening rewrites only the files whose keys changed and removes a file left with none, so agents paying down
  debt on different modules edit different files. · {#baseline-is-one-file-per-path}
  - Implementation: {{baseline-files}}, {{check-run}}, {{ratchet}}, {{text-files}}, {{check-paths}}
  - Proof: {{temporary-project}}

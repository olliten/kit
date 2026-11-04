```yaml
app: tally
roots:
  src: src/
  spec: spec/
  oracle: oracle/
terms: spec/terms.md
verify:
  checks:
    - id: typecheck
      command: node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
    - id: check
      command: node ../../scripts/kit-check.mjs --root . --config kit/config.md --baseline kit/debt/legacy.json --evidence {evidence}
      after: tests
  tests:
    command: node ../../scripts/kit-proof.mjs run --root . --pool=forks --poolOptions.forks.isolate=true {tests} --coverage.enabled --coverage.all=false --coverage.provider=custom --coverage.customProviderModule={provider} --coverage.reporter=lcovonly --coverage.reportOnFailure --coverage.reportsDirectory={dir}
    under: oracle/
packages:
  - { name: vitest, capabilities: [] }
```

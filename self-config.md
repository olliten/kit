# Kit configuration

The Kit app's declarations. Roots are relative to this app, independently of any app's declarations.

```yaml
app: kit
roots:
  src: [src/, oracle/]
  spec: spec/
  oracle: oracle/
terms: spec/terms.md
claim-separator: "·"
legacy-areas: []
exceptions:
  - oracle/code-structure/imports-point-inward.test.ts
  - oracle/code-structure/imports-have-no-cycles.test.ts
dependency-exclusions:
  - from: src
    to: oracle
    imports: all
    reach: direct
packages:
  - name: vitest
    capabilities: [test-runner]
    entrypointExports: [describe, test, expect]
  - name: mdast-util-from-markdown
    capabilities: []
  - name: node:crypto
    capabilities: []
  - name: node:fs
    capabilities: [filesystem]
  - name: node:path
    capabilities: [process-environment]
  - name: typescript
    capabilities: [compiler, filesystem, process-environment]
adapters:
  - module: src/substrate/adapters/filesystem
    export: filesystem
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: Filesystem}
  - module: src/substrate/adapters/compiler
    export: compilerWorkspace
    capability: compiler
    kind: external
    zones: [substrate]
    contract: {type: CompilerWorkspace}
  - module: src/substrate/adapters/compiler
    export: compilerWorkspace
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: CompilerWorkspace}
  - module: src/substrate/adapters/compiler
    export: compilerWorkspace
    capability: process-environment
    kind: external
    zones: [substrate]
    contract: {type: CompilerWorkspace}
```

Filesystem and process-environment are real requirements of the native compiler host. Compiler includes the broader native compiler/host/sys authority, not merely the two methods selected by this adapter. Hashing with `node:crypto` reads nothing, so it is declared pure; TypeScript and the other Node packages are not. The Markdown parser declaration describes its supplied-text default parsing, not immunity from effects in supplied extension callbacks.

The two dependency proofs are checked entrypoints, not rule waivers. Their test registration and assertions
use only the declared Vitest exports. The runner is effectful; shared proof modules gain no runner permission.

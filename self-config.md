# Kit configuration

The Kit app's declarations. Roots are relative to this app, independently of any app's declarations.

```yaml
app: kit
roots:
  src: [oracle/, scripts/, src/]
  spec: spec/
  oracle: oracle/
terms: spec/terms.md
claim-separator: "·"
legacy-areas: []
runs:
  record: self-debt/runs.json
  each: npx vitest run {test} --coverage.enabled --coverage.provider=v8 --coverage.reporter=lcovonly --coverage.reportOnFailure --coverage.reportsDirectory={dir}
exceptions:
  - oracle/code-structure/imports-point-inward.test.ts
  - oracle/code-structure/imports-have-no-cycles.test.ts
  - oracle/kit/source-fixtures-own-their-files.test.ts
  - oracle/code-structure/window-authority-stays-in-shell.test.ts
  - scripts/kit-check.mjs
  - scripts/kit-consumers.mjs
  - scripts/kit-runs.mjs
  - scripts/kit-refs.mjs
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
  - name: mdast-util-gfm-table
    capabilities: []
  - name: micromark-extension-gfm-table
    capabilities: []
  - name: node:crypto
    capabilities: []
  - name: node:fs
    capabilities: [filesystem]
  - name: node:path
    capabilities: [process-environment]
  - name: node:os
    capabilities: [process-environment]
  - name: typescript
    capabilities: [compiler, filesystem, process-environment]
  - name: js-yaml
    capabilities: []
  - name: node:url
    capabilities: []
  - name: node:v8
    capabilities: []
adapters:
  - module: src/substrate/adapters/declared-input-files
    export: declaredInputFiles
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: DeclaredInputFiles}
  - module: src/substrate/adapters/declared-input-files
    export: declaredInputFiles
    capability: process-environment
    kind: external
    zones: [substrate]
    contract: {type: DeclaredInputFiles}
  - module: oracle/substrate/adapters/temporary-project
    export: temporaryProjects
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: TemporaryProjects}
  - module: oracle/substrate/adapters/temporary-project
    export: temporaryProjects
    capability: process-environment
    kind: external
    zones: [substrate]
    contract: {type: TemporaryProjects}
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
  - module: src/substrate/adapters/source-loader.mjs
    export: sourceLoader
    capability: source-loading
    kind: external
    zones: [substrate]
    globals: [process]
    packages: [vite, vite-node]
  - module: src/substrate/adapters/text-files
    export: textFiles
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: TextFiles}
  - module: src/substrate/adapters/processes
    export: processes
    capability: processes
    kind: external
    zones: [substrate]
    contract: {type: Processes}
    globals: [process]
    packages: [node:child_process]
  - module: src/substrate/adapters/snapshot-store
    export: snapshotStore
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: SnapshotStore}
    globals: [Buffer, process]
    primitives: [clock, randomness]
  - module: src/substrate/adapters/snapshot-store
    export: snapshotStore
    capability: process-environment
    kind: external
    zones: [substrate]
    contract: {type: SnapshotStore}
  - module: src/substrate/adapters/stopwatch
    export: stopwatch
    capability: stopwatch
    kind: external
    zones: [substrate]
    contract: {type: Stopwatch}
    globals: [performance]
    primitives: [clock]
```

Filesystem and process-environment are real requirements of the native compiler host. Compiler includes the broader native compiler/host/sys authority, not merely the two methods selected by this adapter. Hashing with `node:crypto` reads nothing, so it is declared pure; TypeScript and the other Node packages are not. The Markdown parser declaration describes its supplied-text default parsing, not immunity from effects in supplied extension callbacks.

The dependency and source-fixture proofs are checked entrypoints, not rule waivers. Their test registration and assertions
use only the declared Vitest exports. The runner is effectful; shared proof modules gain no runner permission.

The launchers in `scripts/` are entrypoints: each loads one Kit composition through the source loader, which is
JavaScript because nothing could load it otherwise. YAML parsing, URL conversion and V8 serialization compute
on what they are given, so they are declared pure.

The temporary-project adapter owns temporary directories and writes. Locating the operating system's
temporary directory uses process-environment authority; `node:os` is not declared pure.

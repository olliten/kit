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
verify:
  checks:
    - id: typecheck
      command: npx tsc --noEmit -p tsconfig.json
    - id: check
      command: node scripts/kit-check.mjs
      after: tests
  tests:
    command: npx vitest run {test} --coverage.enabled --coverage.all=false --coverage.provider=v8 --coverage.reporter=lcovonly --coverage.reportOnFailure --coverage.reportsDirectory={dir}
    under: oracle/
exceptions:
  - oracle/code-structure/imports-point-inward.test.ts
  - oracle/code-structure/imports-have-no-cycles.test.ts
  - oracle/kit/source-fixtures-own-their-files.test.ts
  - oracle/code-structure/window-authority-stays-in-shell.test.ts
  - scripts/kit-check.mjs
  - scripts/kit-consumers.mjs
  - scripts/kit-verify.mjs
  - scripts/kit-refs.mjs
dependency-exclusions:
  - from: src
    to: oracle
    imports: all
    reach: direct
packages:
  - name: vitest
    capabilities: [test-runner]
    entrypointExports: [describe, test, expect, beforeAll, afterAll, afterEach]
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
    packages: [vite, vite-node, node:child_process, node:v8]
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
  - module: src/substrate/adapters/git-refs
    export: gitRefs
    capability: processes
    kind: external
    zones: [substrate]
    contract: {type: GitRefs}
    globals: [process, Buffer]
    packages: [node:child_process]
  - module: src/substrate/adapters/calendar
    export: calendar
    capability: calendar
    kind: external
    zones: [substrate]
    contract: {type: Calendar}
    primitives: [clock]
  - module: src/substrate/adapters/evidence-store
    export: evidenceStore
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: EvidenceStore}
    globals: [process]
    primitives: [clock]
  - module: src/substrate/adapters/evidence-store
    export: evidenceStore
    capability: process-environment
    kind: external
    zones: [substrate]
    contract: {type: EvidenceStore}
  - module: src/substrate/adapters/toolchain
    export: toolchain
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: Toolchain}
    globals: [process]
  - module: src/substrate/adapters/read-recorder.mjs
    export: readRecorder
    capability: read-recording
    kind: external
    zones: [substrate]
    globals: [process]
    packages: [node:module, node:worker_threads]
  - module: src/substrate/adapters/terminal-input
    export: terminalInput
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: TerminalInput}
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

The git-refs adapter runs `git` against `origin` alone, so it holds the processes capability as the processes
adapter does; the calendar reads the wall clock only to name the day a shared pass is published under.

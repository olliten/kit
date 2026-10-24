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
hosts:
  server:
    lib: [node]
    zone: substrate
  proof:
    lib: [node]
    entries:
      - oracle/code-structure/imports-point-inward.test.ts
      - oracle/code-structure/imports-have-no-cycles.test.ts
      - oracle/kit/source-fixtures-own-their-files.test.ts
      - oracle/code-structure/hosts-are-declared.dom.test.ts
    provides:
      vitest: [describe, test, expect]
dependency-exclusions:
  - from: src
    to: oracle
    imports: all
    reach: direct
packages:
  - name: vitest
    capabilities: [test-runner]
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
  - name: node:child_process
    capabilities: [git]
  - name: typescript
    capabilities: [compiler, filesystem, process-environment]
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
  - module: src/substrate/adapters/change-log
    export: changeLog
    capability: git
    kind: external
    zones: [substrate]
    contract: {type: ChangeLog}
  - module: oracle/substrate/adapters/temporary-repository
    export: temporaryRepositories
    capability: git
    kind: external
    zones: [substrate]
    contract: {type: TemporaryRepositories}
  - module: oracle/substrate/adapters/temporary-repository
    export: temporaryRepositories
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: TemporaryRepositories}
  - module: oracle/substrate/adapters/temporary-repository
    export: temporaryRepositories
    capability: process-environment
    kind: external
    zones: [substrate]
    contract: {type: TemporaryRepositories}
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

Kit runs in Node: Substrate in the server host and its proofs in the proof host, both with only Node's
libraries. The dependency, source-fixture and DOM-host proofs are entries the proof host lists, not rule waivers.
Their test registration and assertions use only the Vitest exports the proof host provides. The runner is
effectful; shared proof modules gain no runner permission. Every other claim test is an entry of the proof
host too, so nothing may import it, but only listed entries are compiled and checked.

The change-log adapter is the one place Kit runs git, and only when a check is given `--base`. The
temporary-repository proof adapter runs git too, to build the repositories its proofs read.

The temporary-project adapter owns temporary directories and writes. Locating the operating system's
temporary directory uses process-environment authority; `node:os` is not declared pure.

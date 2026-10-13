# Kit configuration

The Kit app's declarations. Roots are relative to this app, independently of any app's declarations.

```yaml
app: kit
roots:
  src: src/
  spec: spec/
  oracle: oracle/
terms: spec/terms.md
claim-separator: "·"
legacy-areas: []
packages:
  - name: mdast-util-from-markdown
    capabilities: []
  - name: node:fs
    capabilities: [filesystem]
  - name: node:path
    capabilities: [process-environment]
  - name: typescript
    capabilities: [compiler, filesystem, process-environment]
adapters:
  - module: substrate/adapters/filesystem
    export: filesystem
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: Filesystem}
  - module: substrate/adapters/compiler
    export: compilerWorkspace
    capability: compiler
    kind: external
    zones: [substrate]
    contract: {type: CompilerWorkspace}
  - module: substrate/adapters/compiler
    export: compilerWorkspace
    capability: filesystem
    kind: external
    zones: [substrate]
    contract: {type: CompilerWorkspace}
  - module: substrate/adapters/compiler
    export: compilerWorkspace
    capability: process-environment
    kind: external
    zones: [substrate]
    contract: {type: CompilerWorkspace}
```

Filesystem and process-environment are real requirements of the native compiler host. Compiler includes the broader native compiler/host/sys authority, not merely the two methods selected by this adapter. TypeScript and Node packages are not declared pure. The Markdown parser declaration describes its supplied-text default parsing, not immunity from effects in supplied extension callbacks.

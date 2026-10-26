# Code structure

A module's path says what it may do: `src/<zone>/<layer>/<name>.ts`. The core decides and performs no
effect, the shell renders and turns input into data, and the substrate does I/O; within each zone,
primitives hold types and constants, readings derive facts, adapters own one external capability each, and
compositions wire the others into behaviour.

## Placement

- A source file is placed when its path is `<root>/<zone>/<layer>/<name>.ts`, read once by
  {{placement-of}} from {{zone}} and {{layer}}. The name before the first dot and the suffix after the
  last dot are both nonempty; a multi-part suffix does not change the name. Placement and authority use
  this same filename rule. Any other path, an old kind folder included, is legacy. The reader also
  accepts an explicit set of roots: those identities include the root, and the roots must be nonempty,
  distinct, non-overlapping relative directory paths without patterns or dot segments. An invalid set
  is an error; the existing single-root form keeps its identities unchanged. · {#placement-is-read-from-the-path}
  - Proof: {{source-fixture}}
- Without a directory mapping in the config, the four layers keep their own names as folders
  ({{default-config}}, {{layer}}). · {#layers-default-to-their-names}

## Dependencies

- Within a zone, primitives import primitives, readings import primitives or readings, and compositions may
  import any layer. Adapters import only primitive data contracts. Across zones, imports point inward to the
  core; an import with a legacy end is not held, and a repeated import is one finding. · {#imports-point-inward}
  - Implementation: {{dependency-check}}, {{import}}
  - Proof: {{fixture-snapshot}}

- Imports have no cycles; a cycle, a self-import included, is one finding at its first module that names
  every member. · {#imports-have-no-cycles}
  - Implementation: {{dependency-check}}
  - Proof: {{fixture-snapshot}}

- An explicit dependency exclusion selects existing origin and target code by relative file or directory
  paths, chooses all or runtime imports and direct or transitive reach, and follows compiler-resolved
  aliases and re-exports. Runtime separation ignores only established erased edges. Direct boundaries may
  use classified package contracts; transitive separation requires checked import evidence throughout,
  including through helpers. Missing evidence remains a blocking limit, and a baseline cannot waive an
  explicit exclusion or its limits ({{dependency-exclusions}}, {{default-config}}). · {#dependency-exclusions-are-checked}
  - Proof: {{source-fixture}}
- An adapter is a module like any other: its path is its identity and its imports may not form a cycle. · {#adapters-follow-the-same-rules}
  - Implementation: {{dependency-check}}
  - Proof: {{fixture-snapshot}}

## Authority

- Window-only host authority stays in Shell, even if an adapter declaration permits another zone.
  The compiler's DOM and worker declarations distinguish Window-only types and globals from shared
  host APIs; HTTP and cancellation remain available to Substrate. Imports retain this requirement.
  · {#window-authority-stays-in-shell}
  - Implementation: {{authority-graph}}, {{global-authority}}, {{zone-authority-check}}, {{zone-permission}}, {{compiler-facts}}, {{compiler}}, {{authority-recorder}}, {{native-reading}}
  - Proof: {{source-fixture}}

- A module's authority is derived from its actual inputs: runtime imports, ambient globals and parameters
  whose types grant it; a type-only import grants none, and what the checker can't establish is a limit,
  never purity ({{capability-check}}, {{authority-graph}}, {{access-authority}}, {{import-authority}}, {{capability-context}}, {{compiler-check}}, {{compiler-facts}}, {{program-scope}}, {{syntax-reading}}, {{escape-recorder}},
  {{native-reading}}). · {#authority-is-derived}
  - Proof: {{fixture-config}}, {{source-fixture}}
- Only a registered adapter creates authority: it owns its raw operation and its contract in one file, a
  runtime import or re-export inherits it, a reading can't import even its contract type, and the core
  hosts no external adapter. In an explicit root set, a registration names the root-qualified module
  identity rather than choosing a default root. A contract grants no host global: the window object reached
  through a global needs a declared global, whatever types the contract names
  ({{registration-check}}, {{authority-graph}}, {{access-authority}}, {{global-authority}}, {{import-authority}}, {{zone-authority-check}}, {{compiler-facts}}, {{default-config}}, {{authority-recorder}}, {{contract-recorder}}, {{contract-reading}}). · {#adapters-create-authority}
  - Proof: {{source-fixture}}
- Inside an adapter, a host global it declares covers every handle reached through it, and a composition
  holding only the adapter's plain contract holds no native authority ({{authority-graph}}, {{global-authority}}, {{zone-authority-check}}). · {#declared-globals-cover-their-handles}
  - Proof: {{source-fixture}}
- An ambient host global such as `process` is authority: used outside an adapter that declares it, also as
  `globalThis.<name>` or through a cast of `globalThis`, it is a limit ({{global-authority}}, {{syntax-reading}}). · {#host-globals-need-an-adapter}
- A package an adapter declares in its `packages` is that adapter's to import: there the import grants the
  adapter's capability, and anywhere else, the core included, a runtime import of it is a finding even where a
  package row declares it; a package no row declares stays a limit ({{import-authority}}). · {#declared-packages-stay-in-their-adapter}
  - Proof: {{source-fixture}}
- An effectful package contract may restrict runtime imports to selected named exports in exact declared
  entrypoints. Aliases retain the original export name and erased imports grant no authority; other access
  forms, subpaths and missing import evidence stay limits. The permission does not extend to helpers, and
  adapter package ownership takes precedence
  ({{import-authority}}, {{startup-check}}, {{zone-permission}}, {{compiler-facts}}, {{default-config}}, {{import-recorder}}). · {#entrypoint-package-exports-are-checked}
  - Proof: {{source-fixture}}
- A namespace such as `Window` grants only what is reached through it, and a constructor selected from it
  keeps its own authority ({{authority-graph}}, {{zone-authority-check}}). · {#namespaces-grant-what-is-reached}
- A type, a type alias or a declaration merge grants no runtime authority; the value it describes still does
  ({{authority-graph}}, {{compiler-facts}}). · {#erased-types-grant-no-authority}
- The core decides and a reading derives, so neither takes behaviour. An export of a core module or of a
  reading that takes a callable, an accessor or an object with operations, through a parameter, a writable
  property or a mutable collection, is a finding, unless that position is typed as a registered adapter's
  contract or a port its operations return, whose capability the zone rules then check. Behaviour moves
  freely only between the compositions and adapters of one zone, which share its permissions
  ({{behaviour-check}}, {{behaviour-reading}}). · {#core-and-readings-take-data}
  - Proof: {{source-fixture}}
- Only an adapter constructs values of its contract and its ports: an object literal of such a type, or a
  class implementing one, outside the adapter's file is a finding, so a value of a contract carries what the
  adapter's file shows. A declared entrypoint may construct them as test doubles
  ({{construction-check}}, {{contract-recorder}}, {{file-scope}}, {{contract-reading}}, {{fact-walk}}, {{finding}},
  {{compiler}}). · {#only-adapters-construct-contracts}
  - Proof: {{recorded-contracts}}, {{project-snapshot}}
- A native handle or event handler stays authority: a reading or a core composition taking one is a finding. A host value type (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`) is data, and the
  host function it is handed to, such as `fetch`, stays authority ({{authority-graph}}, {{zone-authority-check}}). · {#native-handles-stay-in-adapters}
- A native capability contract is usable in an outer zone only when both its host boundary and its
  registered adapter permit it, and its operation contract establishes the access. Window-only authority
  stays in Shell; the core stays forbidden, and undeclared native authority stays a limit
  ({{zone-permission}}, {{zone-authority-check}}). · {#native-contracts-follow-permitted-zones}
  - Proof: {{source-fixture}}
- An import between legacy and placed code obeys zone boundaries and carries capabilities transitively,
  and a legacy module is not given a layer ({{authority-graph}}, {{edge-check}}, {{zone-authority-check}}, {{dependency-check}}). · {#legacy-edges-keep-zones}
- Imports through project references and path aliases carry the authority of the file they reach, and a
  non-null assertion is allowed only directly on an indexed access ({{compiler-facts}}). · {#project-imports-carry-authority}

## Startup

- An app may declare exact, existing executable entrypoints outside every zone, including claim proofs:
  each may connect Shell and Substrate contracts and use the core's, no module imports it, and its permission
  does not pass to what it imports or exempt it from the capability, write, compiler and cycle checks.
  A proof keeps its topic binding; a test suffix grants no permission. A directory, a pattern, a missing file
  or a zoned module declared as an entrypoint grants nothing ({{startup-check}}, {{authority-graph}}, {{edge-check}}, {{zone-permission}}, {{default-config}}). · {#startup-assembles-outer-zones}
  - Proof: {{source-fixture}}

## Writes

- Only a declared core producer constructs a write set, and only a substrate composition applies one; a
  reading does neither, even when it is registered as a producer ({{construction-check}}, {{zone-permission}}). · {#only-core-producers-construct-writes}
- Shell and substrate compositions may invoke a core producer and carry its write sets without gaining the
  right to construct them, and a reading can't invoke a producer ({{zone-permission}}). · {#compositions-invoke-producers}

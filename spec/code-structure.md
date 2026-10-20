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

- Within a zone, a module imports its own layer or an earlier one; across zones, imports point inward to the
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
  explicit exclusion or its limits ({{dependency-check}}, {{default-config}}). · {#dependency-exclusions-are-checked}
  - Proof: {{source-fixture}}
- An adapter is a module like any other: its path is its identity and its imports may not form a cycle. · {#adapters-follow-the-same-rules}
  - Implementation: {{dependency-check}}
  - Proof: {{fixture-snapshot}}

## Authority

- A module's authority is derived from its actual inputs: runtime imports, ambient globals and parameters
  whose types grant it; a type-only import grants none, and what the checker can't establish is a limit,
  never purity ({{capability-check}}, {{compiler-facts}}). · {#authority-is-derived}
  - Proof: {{fixture-config}}, {{source-fixture}}
- Only a registered adapter creates authority: it owns its raw operation and its contract in one file, a
  runtime import or re-export inherits it, a reading can't import even its contract type, and the core
  hosts no external adapter. In an explicit root set, a registration names the root-qualified module
  identity rather than choosing a default root ({{capability-check}}). · {#adapters-create-authority}
- Inside an adapter, a host global it declares covers every handle reached through it, and a composition
  holding only the adapter's plain contract holds no native authority ({{capability-check}}). · {#declared-globals-cover-their-handles}
  - Proof: {{source-fixture}}
- An ambient host global such as `process` is authority: used outside an adapter that declares it, also as
  `globalThis.<name>` or through a cast of `globalThis`, it is a limit ({{capability-check}}). · {#host-globals-need-an-adapter}
- A package an adapter declares in its `packages` is that adapter's to import: there the import grants the
  adapter's capability, and anywhere else, the core included, a runtime import of it is a finding even where a
  package row declares it; a package no row declares stays a limit ({{capability-check}}). · {#declared-packages-stay-in-their-adapter}
  - Proof: {{source-fixture}}
- An effectful package contract may restrict runtime imports to selected named exports in exact declared
  entrypoints. Aliases retain the original export name and erased imports grant no authority; other access
  forms, subpaths and missing import evidence stay limits. The permission does not extend to helpers or
  remove captured callback authority, and adapter package ownership takes precedence
  ({{capability-check}}, {{compiler-facts}}, {{default-config}}, {{read-snapshot}}). · {#entrypoint-package-exports-are-checked}
  - Proof: {{source-fixture}}
- A namespace such as `Window` grants only what is reached through it, and a constructor selected from it
  keeps its own authority ({{capability-check}}). · {#namespaces-grant-what-is-reached}
- A type, a type alias or a declaration merge grants no runtime authority; the value it describes still does
  ({{capability-check}}, {{compiler-facts}}). · {#erased-types-grant-no-authority}
- A function carries the authority of what it captures: the code its names reach through the declarations
  they name, the writes a mutable value it holds receives in that value's module, and the parameters it
  captures; what can't be followed is charged its whole module. So a callback, getter or method that
  holds the clock can't enter the core, while one that reaches only pure code can, even from a module that
  imports authority ({{capability-check}}, {{compiler-facts}}). · {#functions-carry-their-authority}
  - Proof: {{source-fixture}}
- A native handle or event handler passed as an argument stays authority: it can't enter a reading or a core
  composition. A host value type (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`) is data, and the
  host function it is handed to, such as `fetch`, stays authority ({{capability-check}}). · {#native-handles-stay-in-adapters}
- Registering a handler or carrying a record passes on no authority the caller lacks: a clock closure, a map
  of callbacks or a native handle can't reach the core through a registration, a record or a private
  endpoint. A composition or registered external adapter handing a handle to a function only its own file
  can name crosses no boundary; the module's own authority stays checked. A
  function another file can name, through an export, an exported record or a public method of an exported
  class, is one ({{capability-check}}). · {#registration-passes-no-authority}
- A native capability contract is usable in any outer zone its registered adapter permits, where its operation
  contract establishes the access; the core stays forbidden, and undeclared native authority stays a limit
  ({{capability-check}}). · {#native-contracts-follow-permitted-zones}
  - Proof: {{source-fixture}}
- An import between legacy and placed code obeys zone boundaries and carries capabilities transitively,
  and a legacy module is not given a layer ({{capability-check}}, {{dependency-check}}). · {#legacy-edges-keep-zones}
- Imports through project references and path aliases carry the authority of the file they reach, and a
  non-null assertion is allowed only directly on an indexed access ({{compiler-facts}}). · {#project-imports-carry-authority}

## Startup

- An app may declare exact, existing executable entrypoints outside every zone, including claim proofs:
  each may connect Shell and Substrate contracts and use the core's, no module imports it, and its permission
  does not pass to what it imports or exempt it from the capability, write, compiler and cycle checks.
  A proof keeps its topic binding; a test suffix grants no permission. A directory, a pattern, a missing file
  or a zoned module declared as an entrypoint grants nothing ({{capability-check}}, {{default-config}}). · {#startup-assembles-outer-zones}
  - Proof: {{source-fixture}}

## Writes

- Only a declared core producer constructs a write set, and only a substrate composition applies one; a
  reading does neither, even when it is registered as a producer ({{capability-check}}). · {#only-core-producers-construct-writes}
- Shell and substrate compositions may invoke a core producer and carry its write sets without gaining the
  right to construct them, and a reading can't invoke a producer ({{capability-check}}). · {#compositions-invoke-producers}

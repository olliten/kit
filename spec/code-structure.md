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
- A package an adapter declares in its `packages` is that adapter's to import: there the import grants the
  adapter's capability, and anywhere else, the core included, a runtime import of it is a finding even where a
  package row declares it; a package no row declares stays a limit ({{capability-check}}). · {#declared-packages-stay-in-their-adapter}
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
- A native capability contract is usable in an outer zone only when both its host boundary and its
  registered adapter permit it, and its operation contract establishes the access. Window-only authority
  needs a `dom` host; the core stays forbidden, and undeclared native authority stays a limit
  ({{capability-check}}). · {#native-contracts-follow-permitted-zones}
  - Proof: {{source-fixture}}
- An import between legacy and placed code obeys zone boundaries and carries capabilities transitively,
  and a legacy module is not given a layer ({{capability-check}}, {{dependency-check}}). · {#legacy-edges-keep-zones}
- Imports through project references and path aliases carry the authority of the file they reach, and a
  non-null assertion is allowed only directly on an indexed access ({{compiler-facts}}). · {#project-imports-carry-authority}

## Hosts

- A host is where code runs: the compiler libraries whose globals exist there, and the code that starts
  there. `hosts` names each host's libraries, `dom`, `webworker`, `node` or a package whose ambient
  declarations it provides, and the zone that runs in it; one host runs each zone and the core runs in
  none. A global exists in a host only if one of its libraries declares it: Window-only authority, which
  the compiler's DOM and worker declarations tell apart from shared web APIs, needs `dom`, and a global only
  a package declares needs that package. Imports and captured callbacks keep the requirement. Without
  `hosts`, Shell runs in a `dom` browser, Substrate in a `node` and `webworker` server, and proofs in `dom`
  and `node` ({{capability-check}}, {{compiler-facts}}, {{default-config}}, {{host-of}}). · {#hosts-are-declared}
  - Implementation: {{compiler}}, {{read-snapshot}}
  - Proof: {{source-fixture}}

- A host's globals belong to its adapters. In each host one adapter owns each global it declares, and every
  handle reached through it is that adapter's, so a composition holding only the adapter's plain contract
  holds no native authority. Other code in that host acquires the global only through that adapter. A second
  owner in one host is a finding; two hosts may each own the same name, so a proof-root adapter may own a
  global in the proof host. A package's ambient global such as `process` that no adapter owns in its host,
  also as `globalThis.<name>` or through a cast of `globalThis`, is a limit
  ({{capability-check}}, {{host-of}}). · {#host-globals-have-one-owner}
  - Proof: {{source-fixture}}

- A host starts at its entries: the exact, existing files outside every zone that it lists, and every claim
  test, an entry of the proof host derived from its claim binding. An entry may wire the outer zones'
  contracts and the core's, and import the named runtime exports its host `provides`; nothing imports it,
  and it grants nothing to what it imports or exempts it from the capability, write, compiler and cycle
  checks. A provided export keeps its original name through an alias, grants nothing outside the host's
  entries and leaves its callbacks the package's authority; other access forms, subpaths and missing import
  evidence stay limits. A listed entry is compiled and checked; a claim test the proof host does not list
  keeps only its binding and the import rule. A test suffix, a directory, a pattern, a missing file or a
  zoned module grants nothing. The proof host's `roots` are where tests outside the proof root are found
  ({{capability-check}}, {{compiler-facts}}, {{default-config}}, {{host-of}}, {{read-snapshot}}). · {#hosts-start-at-entries}
  - Proof: {{source-fixture}}

- A host may name the types that carry code into it, `entered-by: [<package>#<type>]` for the package whose
  declarations define the type, such as a browser-automation page function. A function literal passed
  where that type is expected is a program in that host: what it touches is checked against that host's
  libraries and nothing is charged to its caller, and each outer name it captures is a finding, since the
  host runs a serialized copy that keeps only its parameters. The sending call keeps its handle's authority.
  A reference, an `any` or a source string stays a limit
  ({{capability-check}}, {{compiler-facts}}, {{host-of}}, {{read-snapshot}}). · {#entry-types-carry-code-into-a-host}
  - Proof: {{source-fixture}}

## Writes

- Only a declared core producer constructs a write set, and only a substrate composition applies one; a
  reading does neither, even when it is registered as a producer ({{capability-check}}). · {#only-core-producers-construct-writes}
- Shell and substrate compositions may invoke a core producer and carry its write sets without gaining the
  right to construct them, and a reading can't invoke a producer ({{capability-check}}). · {#compositions-invoke-producers}

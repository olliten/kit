# Code structure

[[language]] names these contracts; [[proof]] connects their guarantees to tests.

Each {{module}} has one global concept definition and one source identity. Topics group modules into
narratives; a module may participate in several topics or in none. Topic references do not create another
module or change import permissions. Private helpers may share a module's file. Configuration maps
identities to paths.

### Zones

The {{zone}} boundaries are:

| Zone | Responsibility | Boundary |
|---|---|---|
| core | Decide domain facts and describe changes | No external effects |
| shell | Render views and normalise input | No domain decisions or substrate I/O |
| substrate | Own resources, transport and applying writes | No domain decisions |

Domain decisions run without the browser, transport or storage. External code uses
the core's exported contracts.

### Layers

Each zone has four layers. Dependencies have no cycles.

| Layer | Responsibility |
|---|---|
| primitives | Supplied data schemas, types, rosters and constants without executable construction logic |
| readings | Derive facts from supplied data without effects or writes |
| adapters | Implement narrow external capabilities and state their operation contracts |
| compositions | Connect contracts into behavior using the zone's permitted capabilities |

Primitives import primitives. Readings import primitives and readings. Adapters
import primitive data contracts, never readings, compositions or other adapters.
Compositions may import all four layers. These adapter restrictions also hold
across zones; the inward zone rule still applies. Core has no external adapters.

A primitive does not coordinate a workflow. Readings may compose other readings.
Core compositions describe writes and effect requests without performing an external
effect. Shell and substrate compositions interpret descriptions through adapters.

A schema needs no fabricated runtime value.

### Capabilities

A capability is access to a narrow set of related operations, such as sampling the
clock or reading and restoring the caret. Its adapter owns the real implementation
and its operation contract in the same file. Shared plain data contracts belong with
their concepts; they need no duplicate capability schema. The adapter roster names
these boundaries and their types. Rendering, input, focus and scroll, clipboard,
storage, transport, clock, randomness and timers have narrow contracts rather than
one platform interface.

Only adapters create authority. A module gains access when it imports an implementation
or receives a parameter whose type grants that access. Inside an adapter, a declared host
global covers every handle reached through it; the adapter's contract decides what leaves. For example, a Clock parameter
with a now method lets the module sample the clock; a timestamp parameter does not.

A runtime import inherits the supplying module's capabilities, even when the selected
export does not use them. Type-only imports grant no access. Requirements propagate
through runtime imports. They describe what a module may do, not what each execution
does.

Descriptions are data: an offered action or request states an operation and its
arguments, never a closure over authority. Carrying a description grants no capability.
Compositions and harnesses connect capability contracts to implementations.

#### Reading inputs

Readings accept data, never supplied functions. Data is plain values and readonly
records and arrays of data. A reading may map it with private helpers, imported
readings and supported built-ins. A readonly type alone does not prove a runtime
value is plain.

#### Composition inputs

A composition may accept functions. A closure retains the capabilities of the module
where it is created. A function is not an operation description merely because it is
returned in a record. When the checker cannot establish a connection's capabilities,
it reports that uncertainty rather than calling it pure.

Only declared Core producers construct write descriptions and make their domain decisions.
Shell and Substrate compositions may invoke those Core changes and carry their descriptions.
Applying writes still requires its separate permitted capability.
Readings neither construct write descriptions nor invoke changes that produce them.
Inspecting or carrying an existing write set grants no application capability.

### State

The app declares which state is persisted, session-only, undoable, replicated or
event-sourced. Session state does not survive restart. Changes to persisted schemas
migrate the values the app promises to retain. Undo restores every reading unless
a value declares itself undo-exempt.
Replicated copies converge. In an event-sourced store, applying writes appends the
declared operation group. Stored fields are readings of the event log. Rollback is
a described change.

Views expose the facts and offered actions a surface needs. Dispatch returns an
action description. A composition with the required capabilities interprets it.
Views have stable identities so rendering patches only what changed.
### R1: zones and capabilities

A module's capabilities must be permitted by its zone. Readings perform no external
effect, produce no writes and apply no writes.

The language adapter checks supported primitive access. Raw operations occur only
in their adapters. Reading the clock differs from converting a supplied timestamp.
Aliases and re-exports retain the supplying module's capabilities.

Authority enters through ambient globals, runtime imports and parameters whose
contracts grant it. Readings accept data contracts. Calls do not introduce an
additional capability; they use the capabilities of their inputs and implementation.
The adapter checks executable members and accessors visible in a reading's parameter
type. It does not prove that an arbitrary runtime object is free of getters or proxies.

Capabilities propagate through legacy modules without assigning them a layer. An
unknown external package produces a finding at its import. One package declaration
in the configuration states its capabilities. An unsupported authority entry remains
an explicit checker limit, never evidence of purity. Ordinary calls and arbitrary
data provenance do not produce separate uncertainty findings.

Each zone compiles against only the APIs it may touch. Loosening its required
compiler settings is a finding. Exports state their types.
Domain values use their term's type unless the term is declared plain. Compared
fixed literals have union types. Untyped values, non-const type assertions and suppressed
type errors are findings. A non-null assertion directly on an indexed access, such as
`items[i]!`, is permitted. Other non-null assertions are type escapes. Literal `as const`
preserves precision and is permitted.

A rule that the checker cannot establish is checked by a person. For example,
whether a shell module invents a domain decision needs review when the structure
alone cannot establish it. The finding states this limit.

### R2: dependencies and writes

Imports follow the layer relationships in the model and point inward across zones.
Adapter dependencies are primitives even across zones. Cycles are findings.

During migration, legacy layer ordering governs legacy-to-legacy imports, and
Kit layer ordering governs placed-to-placed imports. Imports between them still
obey zone boundaries and transitive capability restrictions. A legacy module
without a Kit layer is not assigned a fictitious layer.

Readings never call code that produces or applies writes. A visible write-set
construction outside its declared Core producer module is a finding.
Inspection and transport of an existing description do not produce writes.

Spreading an existing write set into a new one is a visible construction. A private
type brand does not exempt that construction from its production capability.

Private implementation mutation is not a domain-state write by itself. It must not
escape or alter the promised result. A memo equals the uncached reading. Behavior
the adapter cannot establish remains explicit rather than assumed harmless.

## Contracts

### core/primitives/zones

Keep permission boundaries independent of topic grouping. Uses {{zone}}.

### core/primitives/layer

Supply the dependency roster used by placement and permission checks. Uses {{layer}}.

### core/primitives/import

Keep dependency evidence separate from the checks that interpret it. Uses {{import}}.

### core/primitives/module

Supply heading identities without binding them to source during acquisition. Uses {{module}}.

### core/primitives/compiler-facts

Give core checks compiler observations without native compiler handles. Uses {{compiler-facts}}.

### core/readings/placement-of

Interpret configured paths once so checks agree about placement. Uses {{placement-of}}.

### core/readings/dependency-check

Report forbidden edges and cycles from the shared placement interpretation. Uses {{dependency-check}}.

### core/readings/capability-check

Keep established requirements and unsupported authority evidence visible together. Uses {{capability-check}}.

## Proof obligations

- runtime authority is conservatively derived from actual module inputs. · {#authority-is-derived}
- a core composition may produce an actual write set without a primitive constructor wrapper. · {#capability-producers-follow-layers}
- a chain is acyclic. · {#dependency-check-acyclic}
- Imports follow the declared primitive, reading, adapter and composition relationships and point inward across zones. · {#dependency-check-direction}
- every kit source file under src/ is placed. · {#dependency-check-self-hosted}
- Placement is read from <root>/<zone>/<layer>/<name>; an old kind folder is legacy, not a placement. · {#kind-of-layout}
- omitting the directory mapping retains the four canonical default layers. · {#layers-map-paths}
- a parenthesized index is outside the directly indexed assertion permission. · {#project-imports-carry-authority}

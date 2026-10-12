# Model

## Model

A module is one named contract. Its identity is `<zone>/<layer>/<name>`. One topic
heading names it and one source file implements it. Private helpers may share that
file. The configuration maps identities to paths.

### Zones

A zone states which capabilities its modules may use.

| Zone | Responsibility | Boundary |
|---|---|---|
| core | Decide domain facts and describe changes | No external effects |
| shell | Render views and normalise input | No domain decisions or substrate I/O |
| substrate | Own resources, transport and applying writes | No domain decisions |

Domain decisions run without the browser, transport or storage. External code uses
the core's exported contracts.

### Layers

Each zone has three layers. Imports point down or sideways, never up. Dependencies
have no cycles.

| Layer | Responsibility |
|---|---|
| primitives | Values, types, schemas, rosters, construction operations and narrow capability adapters |
| readings | Derive facts from supplied data without effects or writes |
| compositions | Connect contracts into behavior using the zone's permitted capabilities |

A primitive does not coordinate a workflow. Readings may compose other readings.
Core compositions describe writes and effect requests without performing an external
effect. Shell and substrate compositions interpret descriptions through adapters.

A schema needs no fabricated runtime value.

### Capabilities

A capability is access to one operation, such as sampling the clock or storing a
value. Its adapter owns the real operation and its contract. The adapter roster names
these boundaries and their types. Rendering, input, focus and scroll, clipboard,
storage, transport, clock, randomness and timers have narrow contracts rather than
one platform interface.

Only adapters create authority. A module gains access when it imports an implementation
or receives a parameter whose type grants that access. For example, a Clock parameter
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

Producing writes and applying writes are separate capabilities. Inspecting or carrying
an existing write set needs neither. Constructing one needs production capability;
applying it needs application capability.

### Topics

A topic is the unit the owner ratifies and the agent works from. It explains why its
modules exist and how they compose. Each module has one topic home; other topics
reference its public contracts.

Each claim appears once in its topic under a stable anchor. It may describe a module
or a composition. Several tests may prove its consequences. Claims need no artificial
single-module owner. The terms file defines the app's words once.

A claim declaration is an anchor that closes a Markdown list item or heading,
after the configured separator or bare. Other occurrences are references.
Paragraph reflow does not change their role. New topics declare claims in list
items. Legacy law headings declare claims only in configured legacy area files.
One structural reader owns this grammar.

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

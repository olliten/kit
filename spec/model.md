# model — three zones, five kinds

> A **module** is one named piece of data, state, reading, change or effect. Its identity `<zone>/<kind>/<name>` is
> carried by one spec heading, one code file and its tests. Every module of an app is one cell: a zone (what it may
> do) × a kind (its signature). The kit holds an app to this model and names no app concept. The app declares itself
> in its config.

## Zones

| Zone | It … | It never … |
|---|---|---|
| core | decides everything | performs an effect: no clock, randomness, I/O or global counter |
| shell | turns views into pixels and raw input into normalised input; may decide presentation (what to mount, when to paint) | decides anything about a core fact |
| substrate | performs I/O; holds every state cell and applies write sets; may hold transport policy (ordering, resend, echo matching) | holds a domain rule or a core name |

## Kinds

| Kind | Signature | Its laws, the same in every zone |
|---|---|---|
| data | a constant, no writer | holds no logic; equals its roster in the spec; public |
| state | a value written only by applying a change's write set | private to its zone; held by the substrate's store in the form the app chooses |
| reading | `(…) → value`, pure | total and deterministic; may be memoized in place when the memo always equals it |
| change | `(…) → write set + effect requests`, pure | the write set is applied atomically; effect results return as normalised input; it may sequence writers, branch on readings and describe failure handling, and computes no fact of its own; time and fresh ids are inputs |
| effect | performs I/O | holds no domain rule; carries out what a change requested and reports the result as normalised input |

## State properties (declared per app, never assumed)

| Property | Applies when | Its law |
|---|---|---|
| persisted / session | always | session state does not survive a restart; a schema change migrates persisted state without losing what the app declares it keeps |
| undoable | the app declares undo | undo of a write set restores every reading; an undo-exempt value says so |
| replicated | the app keeps optimistic or offline copies | the local copy converges to the authoritative one; rollback is a change |
| event-sourced | the app stores events | stored fields are readings of the event log; the only writer appends a write set |

## Derived terms

- A **view** is a core reading whose value is exactly what one render draws: items with stable identity, their facts,
  and the changes each offers. Views are keyed, so a render patches only what changed.
- **Dispatch** is a core reading from normalised input plus state to the change it fires.
- A **surface** is a shell render plus the decoding of its raw input.
- A **behaviour** is normalised input → dispatch → change → views.
- A **journey** is a change marked `wiring`, also run through all three zones.

## Topics

A **topic** is the unit the owner ratifies: prose that says why its modules exist and how they compose into what a
user experiences, ending in their headings and the claims the oracle reads. Every module sits in exactly one topic.
The owner ratifies topics; agents bind code and tests beneath them and never invent the split. A **feature** is a
topic that names something a user can do.

## The kit's own modules in this model

### core/data/zones — the three zones and what each may never do
- def: the zone table above, as data.

### core/data/kinds — the five kinds and their order within a zone
- def: the kind table above, with the order data ← state ← reading ← change ← effect.

### core/data/default-config — the target, as defaults
- def: the zone roots, the spec and oracle roots, the test pattern `<name>.<law>.test.ts` and the tier per zone.
  An app overrides names, never structure.

### core/reading/kind-of — a module's zone and kind, read from its path
- def: a path `<root>/<zone>/<kind>/<name>` gives that zone and kind. Any other source path is legacy.

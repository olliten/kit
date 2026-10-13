# Proof

This connects guarantees from [[code-structure]] and [[language]] to independent evidence.

### Topics

Topics group {{module}} contracts into narratives. A module may participate in several topics or in none;
topic grouping changes neither its identity nor its import permissions.

Each claim appears once in its topic under a stable anchor. It may describe a module
or a composition. Several tests may prove its consequences. Claims need no artificial
single-module owner. The terms file defines the app's words once.

A claim declaration is an anchor that closes a Markdown list item or heading,
after the configured separator or bare. Other occurrences are references.
Paragraph reflow does not change their role. New topics declare claims in list
items. Legacy law headings declare claims only in configured legacy area files.
One structural reader owns this grammar.

### R4: proof

Every claim is named by one or more tests. Every law test names a claim or an
applicable structural obligation. Tests use public contracts; structural checks
may inspect the facts they establish.

A claim test lives under the configured oracle root, in the directory named for
its owning topic: `<oracle-root>/<topic>/<claim-anchor>.<variant>.test.ts`, or
`<oracle-root>/<topic>/<claim-anchor>.test.ts`. A structural obligation's tests
live with the topic that states it. Neither the topic directory nor the filename
selects the test environment.
Imports show reachability, not execution or proof of a claim.

Harnesses connect contracts to real or fake implementations. These connections
establish their environment requirements. Real DOM use needs a browser; real resource
access needs its contract environment. Requirements compose. An unresolved connection
cannot silently select a cheaper environment. Supplying a fake does not erase a
direct import of the real implementation.

Each adapter with a fake has one contract suite run against both implementations,
including the contract's timing and failure behavior. The Kit checks that the suite
and both runs exist; execution proves their results. Separate integration tests prove
real wiring. Fake-backed tests do not replace required surface proof or the owner's
reference rendering.

Ordering, atomicity, idempotency and exclusion are claims in the owning topic,
proved at the composition where they matter. Completing each request once does
not prove that concurrent requests preserve an established binding.

Cost tests observe boundary inputs and outputs. Production code does not maintain
counters solely for tests. A test-only observation hook must be declared once in the
app's configuration; undeclared hooks are findings.


## Contracts

### core/primitives/claim

Keep partial ClaimMarker and located Claim shapes together; promise identity does not require a constructor or a separate helper term. Uses {{claim}}.

### core/readings/claim-inventory

Read claim declarations and uses without deciding where their tests belong. Uses {{claim-inventory}}.

### core/readings/module-binder

Keep module-to-source binding independent of claim-to-proof binding. Uses {{module-binder}}.

### core/readings/claim-proof-binder

Share proof-path interpretation with checks that inspect tests. Uses {{claim-proof-binder}}.

## Proof obligations

- Module and claim binding: one path in spec, code and oracle. · {#binder-binding}
- Claim declarations and topic-first proofs bind in both directions, without treating paragraph reflow as a new declaration. · {#claims-have-one-home}

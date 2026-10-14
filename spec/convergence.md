# Convergence

## Convergence

The derived ledger shows each module's placement, findings, debt and proofs.
Debt is keyed and states what resolves it. Placement-independent violations in legacy
code are debt that only drains. Zone permissions, layer direction and reading inputs
are checked where placement is declared. Checker limits are reported separately and
never become debt; a limit cannot establish a required guarantee. New debt and placed
violations fail the ratchet.
A module never moves backwards in placement.

Topics group meaning, not access rights. Their derived view shows claims, public
contracts other topics use, proofs, dependencies and affected tests. Regrouping topics
does not change what modules may import.

A feature checks whether its topics still fit and proposes regrouping to the maintainer
when they do not. Its report names the topics added, changed and touched through modules.

## The Kit

The Kit names no app concept. App-specific declarations live in the app's
configuration. It checks its own modules using the same model.

The Kit checks architectural guarantees without prescribing a Kit-specific style.
Code uses plain functions, unions, readonly data and ordinary language declarations.
There are no Kit decorators, registration calls, generated base classes or duplicate
module annotations. Adapters own genuine boundaries, not wrappers added only to
satisfy a checker.

When clear, idiomatic code fails a check, examine the approximation before adding
scaffolding. Preserve the guarantee through a better check, explicit uncertainty,
human review or runtime proof.

Each architectural fact has one authoritative representation. Paths, contracts,
topics, adapter rosters and harnesses are not repeated in separate manifests.
The checker, ledger and topic view read the same snapshot. Contract suites use the
existing runner.

The Kit stays below 10% of the source it governs. Each check names its rule and each
finding names its fix and limits. The fixture demonstrates the ratchet. Configuration,
debt and ledger stay with each app; the Kit is a separate package.

Only the Kit lane changes its spec, source and oracle. The maintainer approves each such
change. No agent weakens a check to pass its own work. Its public commands are check,
ledger, partition and rename.

[[code-structure]], [[language]] and [[proof]] supply the guarantees this process holds.

## Contracts

### core/readings/finding

Give independent checks a common result without adding a schema-only module. Uses {{finding}}.

## Proof obligations

- The ratchet rejects new legacy debt, every placed violation and every checker limit reachable from placed code. · {#ratchet-keeps-architecture-obligations}
- a finding carries rule, path and fix, and a debt key from rule, check, path and detail. · {#finding-debt-key}

# The method

Kit is a method first and a TypeScript checker second. This page states the method without the language, so it
can be implemented for another one.

## The pieces

- **Topics** are the spec: each a title, a short intro, sections and claims. A claim is one promise, with an
  anchor, the modules that implement it and the shared modules that prove it.
- **Terms** are the vocabulary: each word defined once, and each module bound to one term with a role and a zone.
- **Proofs** are tests, one file per claim, named by its anchor.
- **Modules** live at a path that says what they may do: a zone (core, shell, substrate) and a layer (primitives,
  readings, adapters, compositions).
- **Adapters** are the only places an effect happens. Each has a contract type; values of it are built only by the
  adapter.

## The rules

1. **Placement.** A module's path is its zone and layer, and its name is its term.
2. **Dependencies.** Imports point down the layers and inward to the core, without cycles.
3. **Authority.** A module's authority is its imports and the contract types it takes. The core and readings take
   data or contracts, never other behaviour; behaviour moves freely only within one zone's compositions and
   adapters.
4. **Proof.** Every claim has a test, every test names a claim, every module is named by a claim, a claim's tests
   reach the modules it names, and claims that share no code share no module.
5. **Language.** Every word is defined once; comments say only why.
6. **Convergence.** Existing code is legacy. Its findings and its size are debt in a baseline that may only
   shrink. Outside code hands placed code only data or contracts.

## Findings

A finding has a rule, a path, a fix and a debt key made of the rule, the check, the path and a detail. The detail
names where the finding is by enclosing names and syntax, never by offset, so parallel edits keep it stable. A
placed violation always fails. Legacy debt fails only when it is new. What the checker can't establish is a limit,
never treated as pure.

## The workflow

Plan first, serially: the topic, the terms, the contract types and the adapter registrations. Then work in
parallel: one agent per claim test or per module, each in its own file.

## What an implementation must supply

An extractor reads a codebase into a snapshot, whose shape is the interface:
`src/core/primitives/snapshot.ts` and `src/core/primitives/compiler-facts.ts`. The checks in `src/core/readings/`
consume only that shape. The TypeScript extractor, `src/substrate/compositions/read-snapshot.ts` with the
`compiler` adapter, is the first implementation. Another language needs a new extractor that fills the same
facts: files, imports, exports and what they accept, contract types and ports, constructions, host globals and
accesses, and for each test the files and top-level declarations its code reaches.

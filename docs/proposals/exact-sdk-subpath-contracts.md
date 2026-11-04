# Proposal: exact public SDK subpath contracts

Status: **UNAPPROVED — Olli's model decision required.** This document proposes wording and proofs;
it changes no authoritative spec, implementation, configuration, permission or baseline.

## Why this is needed

Kit now owns the browser mapping and runtime-identity implementations. Their eventual public SDK entry
needs an honest external contract without classifying the entire `kit` package as pure or effectful.
A namespace alias would not establish that ownership. A declared SDK subpath must be a real supported
package entry, established by resolution/integration proof; this proposal does not invent one.

The existing `packages.name` string can express that boundary; no new configuration key is proposed.
Global lookup currently uses only the parsed package root in `import-authority.ts`. Direct dependency
exclusions independently use the same root-only classification. Adapter package ownership already
supports exact subpaths and must keep precedence.

## Current authority and proposed wording

`spec/code-structure.md#entrypoint-package-exports-are-checked` currently says that other
"access forms, subpaths and missing import evidence stay limits." Allowing a separately declared global
subpath therefore needs a normative amendment, rather than a checker precision fix.

Proposed new claim, alongside the existing package claims:

> A global package contract whose name equals the full import specifier is selected before the existing
> package-root contract. Names match literally, never by prefix or normalization. An exact subpath
> contract grants nothing to the root, siblings or descendants. Adapter package ownership takes
> precedence over either global contract.

Proposed replacement wording for the restricted-entrypoint claim:

> An effectful package contract may restrict runtime imports to selected named exports in actual
> declared entrypoints at that contract's exact specifier. Aliases retain the original export name and
> erased imports grant no authority; other access forms and missing import evidence stay limits.
> A subpath with its own global contract follows that contract; a restricted root contract alone permits
> no subpath. Permission does not extend to helpers, and adapter package ownership takes precedence.

For direct dependency exclusions, the same exact global/root fallback and existing exact-or-root adapter
declarations establish classified external boundaries. Classification does not itself grant authority: ownership,
export restrictions, zones and native-handle checks still run. Transitive exclusions still require
checked import evidence throughout; no external row supplies a missing transitive graph.

## Examples and matching rule

These planned SDK entries are illustrative, pending actual public exports and their proofs:

```yaml
packages:
  - { name: 'kit/browser', capabilities: [browser-driving, filesystem] }
  - { name: 'kit/browser-mapping', capabilities: [] }
  - name: '@example/sdk/start'
    capabilities: [test-runner]
    entrypointExports: [start]
```

`kit/browser` does not classify `kit`, `kit/browser/internal` or `kit/other`. A different literal
specifier, including a query/hash variant or dot/path alias, gains nothing from that row. An existing
root row, when present, retains its existing fallback behavior independently.

Where root and exact contracts both exist, the exact contract wins without unioning capabilities,
regardless of their order. For example, `@example/sdk/format` with no effects may explicitly narrow
an effectful `@example/sdk` root contract if the actual public formatter is pure.

## Required proof matrix

| Case | Required outcome |
| --- | --- |
| Ordinary and scoped exact public specifiers | Select their own declared capabilities. |
| Root and exact rows, in either order | Exact row wins; root capabilities are not unioned. |
| Root-only configuration and imports | Existing fallback and restrictions are unchanged. |
| Root, sibling, descendant, query/hash and dot variants of an exact-only row | Receive no permission from that row. Local aliases keep ordinary compiler resolution. |
| Exact or root adapter ownership versus an exact global pure row | Adapter ownership wins; imports outside its owner remain findings. |
| Restricted exact row, actual entrypoint, allowed named import or rename | Permit the original allowed export only. |
| Restricted helper, namespace/default/dynamic/re-export access or absent named-import evidence | Remain limits. |
| Restricted root alone, importing a subpath | Remain a limit. |
| Erased imports | Grant no runtime authority. |
| Effectful exact contract imported into Core | Existing zone/native-authority restrictions still reject it. |
| Direct exclusion using an exact external contract | Recognize classification while preserving authority checks. |
| Transitive exclusion with incomplete external evidence | Remain blocked; no fabricated transitive reach. |
| Claimed public SDK entry | Actual package resolution and its independently proved implementation agree. |

Existing package-root, ownership, native-handle and dependency-exclusion proofs must remain green.
Evidence producer/dependency identity is unchanged by this proposal.

## Decisions to ratify

1. Approve the exact-before-root model and the wording above, including explicit exact narrowing and
   consistent direct-boundary classification. This is the proposed minimum SDK adoption prerequisite.
2. Decide duplicate names explicitly. Restricted contracts already require unique names; unrestricted
   duplicates currently follow first-row lookup. The recommendation is one general unique-name rule for
   package contracts, rather than a new order-dependent exact-row policy. That additional validation
   change needs explicit approval and compatibility proofs; it must not be silently included.

Only after ratification should an independent oracle pin the approved semantics and source converge to
them. Browser capture/writer implementation and application adoption remain separate slices.

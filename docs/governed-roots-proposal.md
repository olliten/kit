# Govern application and oracle code with the same rules

Proposed extension, not the current Kit contract. This PR changes no checker, configuration or baseline.
The current contract remains in `spec/`. The examples below separate what already works from what later
PRs must establish.

## Purpose

Shared test infrastructure should have the same visible dependencies, effect boundaries and shrinking
debt as application code. This makes reuse discoverable and prevents each new proof from adding another
setup path. Structure alone promises no runtime reduction: measure actual claim execution as well as
checking cost when migrating a capability.

## Shared rules

1. A governed root contains the existing zones and layers. The root identifies a module; it grants no
   capability. Do not introduce an oracle-specific interpretation of a reading or adapter.
2. Primitives hold data contracts and constants. Readings derive facts. Adapters own external
   capabilities and depend only on primitive contracts. Compositions connect modules. The existing
   layer, zone and cycle rules apply within and between roots.
3. Authority follows imports, inputs and captured behavior. Registrations and framework callbacks do
   not hide authority. An unresolved boundary remains a checker limit.
4. A configured executable entrypoint may assemble permitted contracts. Its permission stays local;
   called helpers gain none. Claim identity and entrypoint placement are separate facts about a file.
5. Topics may name shared modules from either root. Module references, proof reach and reverse
   references use one graph. A reference must resolve to one module; a matching basename in another
   root is not evidence that a proof reaches the named module.
6. Existing legacy debt may shrink. Governed modules satisfy all applicable rules. A baseline cannot
   waive a placed violation or a reachable checker limit.

Use one placement interpretation, snapshot, import graph, capability engine and ratchet. Keep existing
single-root configuration working. Invalidate incompatible extraction caches explicitly. Root-aware
identities must distinguish findings without silently replacing existing source debt keys.

## Boundaries between roots

Root membership does not decide purity or authority. Declare only the restrictions the project needs:

| Connection | Proposed result |
|---|---|
| Application to oracle, including type-only imports | Reject |
| Oracle composition to permitted application core behavior | Allow under the existing layer and capability rules |
| Oracle adapter to its declared external framework | Allow only for that adapter's declared operations |
| Pure reference model to the production behavior it judges | Reject direct and transitive runtime dependencies |
| Reference model to a primitive data contract | Allow type-only use when the existing dependency rules permit it |
| Any module to a forbidden zone or later layer | Reject regardless of root |

Model independence requires an explicit set of model modules and excluded implementation modules. Purity
is insufficient: a pure function can call the algorithm it is supposed to judge. Begin with file-level
runtime dependency exclusion, not a general policy language. Follow aliases, re-exports and helpers;
exclude a type-only edge only when the compiler establishes its erasure. Unknown reach is a limit.
This check establishes separation, not model correctness or assertion strength.

Global term names remain unique. Root-qualified internal identities do not introduce a second glossary
or a new reference syntax. Ambiguous bindings must fail rather than select the first matching module.

## Frameworks and entrypoints

A claim composition registers proofs and reports results. Pure models and comparisons take and return
plain data. Effectful application access belongs in adapters. A test runner's registration is an
executable boundary, as application startup and event registration are executable boundaries.

Vitest registration, hooks and assertions need explicit package/operation contracts. Playwright handles
retain their browser authority. Generator construction and generated execution need separate treatment;
do not declare an entire property-testing package pure without inspecting the operations and callbacks.
Reuse existing contracts and native-handle analysis before extending them. Do not require forwarding
wrappers around every framework call. Do not exempt test bodies from checking.

The exact external operation declarations and test-entrypoint recognition remain implementation
questions. Prove them with real framework examples before enabling oracle governance. A `.test.ts`
suffix alone grants no permission.

An initial layout may use:

```text
oracle/
  core/
    primitives/<name>.ts
    readings/<name>.ts
    compositions/<name>.ts
  substrate/
    adapters/<name>.ts
    compositions/<name>.ts
    compositions/<topic>/<anchor>.<variant>.test.ts
```

Nested claim files are explicit executable entrypoints, not ordinary flat helper modules. They retain
their topic/anchor binding and need no duplicate helper-module term. Existing proof paths remain valid
during adoption. Do not create empty layers or a shell zone until a capability needs them.

## Executable examples in this PR

The existing adapter and callable-authority tests exercise the real checks. Each configures exactly one
code root, first `src`, then `oracle`. Relative imports and capability declarations keep the same meaning.
These are portability controls, not simultaneous governance of two roots.

| Existing test file under `oracle/code-structure/` | What it establishes |
|---|---|
| `adapters-follow-the-same-rules.test.ts` | Placement, legal and forbidden layer/zone edges, and cycles under either root |
| `functions-carry-their-authority.test.ts` | Pure callbacks pass; clock callbacks fail, directly and through a relay, under either root |

The callable tests compile real fixture files, require a compiler project with no diagnostics and run
the capability checker. They reuse `sourceFixture`; the superseded temporary-directory setup is deleted.
Existing source cases and assertion requirements remain. No checker implementation changes.

Run the examples with:

```sh
npm test -- oracle/code-structure/adapters-follow-the-same-rules.test.ts \
  oracle/code-structure/functions-carry-their-authority.test.ts --maxWorkers=1 --minWorkers=1
```

## Acceptance examples for later PRs

These are required outcomes, not passing coverage claimed by this PR. Add them to the corresponding
existing claim tests as the rules enter the spec; do not create a second acceptance runner.

| Change | Positive control | Negative control |
|---|---|---|
| Multiple roots | Both roots remain checked in the same snapshot | Invalid edge in either root fails; same relative identity does not collide |
| Root boundaries | Oracle composition executes a permitted product core function | Product importing oracle fails, including through a helper |
| Model independence | Independent model and erased primitive contracts pass | Direct, re-exported and helper-mediated implementation imports fail |
| Executable entrypoints | Real Vitest registration and a pure generated claim pass | Clock access in a registered test body cannot escape checking |
| Native authority | Real Playwright handle reaches its declared adapter | Handle or captured browser method entering a model fails |
| References and proof reach | Two topics share one oracle module; path refs find both | Unused or ambiguous named module is rejected |
| Debt | Removing old helper debt tightens the existing baseline | New legacy test helper or moved unpaid debt cannot disappear from accounting |
| Compatibility and caching | Existing source-only config retains its findings | Changing either governed root invalidates affected evidence; cached/fresh checks agree |

## Adoption and review boundaries

First centralize placement without changing behavior. Then add multiple roots, executable boundaries,
dependency restrictions, references and debt in separate small PRs. Do not enable a second root until
its relevant checks support it; unsupported configuration must not silently pass.

Inventory legacy test infrastructure at a fixed adoption revision, including helpers outside `oracle/`.
Preserve paid and unpaid debt through renames. Keep claim binding and proof reach blocking; only existing
legacy structural findings enter the adoption baseline. Do not refresh unrelated source debt.

Finally migrate one complete capability used by two topics. Update all consumers and delete its
predecessors in the same PR. Preserve claims, assertions, generated cases and execution isolation. Plant
a defect to check detection. Report duplication removed, import reach, checking cost and actual test
duration before choosing the next capability. A browser-to-headless rewrite is a separate change.

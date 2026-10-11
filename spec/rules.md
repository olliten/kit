# rules — the four rules every check serves

> A check exists only to hold one of these rules. Every finding names the rule, the module's path and the fix.

| # | Rule |
|---|---|
| R1 | **Zones.** The core performs no effect. The shell decides nothing about a core fact; its only output to the core is normalised input. The substrate holds no domain rule or core name. |
| R2 | **Dependencies.** Within a zone, data ← state ← reading ← change ← effect, acyclic. Across zones, only inward to the core, and only to its data, readings and changes: core state is private. |
| R3 | **Binding.** `<zone>/<kind>/<name>`, the name in kebab-case, is a module's identity; the spec heading, the code file and the tests (`<name>.<law>.test.ts`) each carry it, and the config maps it to file paths. One module per file; private helpers may live inside it. The folder decides the kind; where the language has types, the type must agree. A rename moves all three together. **Names.** The app's terms file defines every domain term once, one line each: `- **term** — meaning`, optionally ending `Retired: <words>`. A compound term (`running-total`) is a term of its own; every value of a roster is a term too. Topics use terms freely and define none. Module names, exported symbols and test names use only terms and the config's connectors; path segments are structure. A second definition, an undefined word in a name, or a retired word anywhere is a finding. The kit generates where each term is used. |
| R4 | **Proof.** A law attaches to a kind, proved once across every module of that kind, or to one module. Every claim in a topic names the module whose law test proves it, and every law test proves a claim or a kind law. Per-module tests use only public faces; kind-law tests may also see state. The tier follows the zone: core headless, shell browser, substrate contract. A change marked `wiring` also runs full-stack. A cost is measured by wrapping inputs, never by counters inside; test hooks enter only through the declared probe port. |

## The kit's own modules for the rules

### core/reading/snapshot — one normalised value of a codebase
- def: the files (path), the imports (from → to), the spec headings (module identities), the test files, the debt lists
  and the config. Every check reads only this value.

### core/reading/finding — what a check reports
- def: `{ rule, path, fix, debtKey }`. The fix says, in one sentence, the change that clears the finding.

### core/reading/binder — R3: heading, file and tests name the same module
- def: a finding for each heading with no file, each file under a zone with no heading, and each test file whose
  prefix names no module.

### core/reading/name-check — R3: names are built from defined terms
- def: a finding for each term defined twice, each word of a module name, exported symbol or test name that is
  neither a term nor a connector the config declares, and each retired word anywhere in the spec, the code names or
  the test names.

### core/reading/dependency-check — R2: imports point forward within a zone and inward across zones
- def: a finding for each import that points backward in the kind order, crosses zones outward, or reaches core
  state from outside the core; and one for each cycle.

### substrate/effect/read-snapshot — read a repository into a snapshot
- def: walks the configured roots, reads imports and spec headings, and lists the test files. It is the kit's only
  effect, and the only place a language adapter lives.

Still to build, as further modules: R1's zone checks, the claim ↔ test binding, the tier partition, the kind-law roster, the ledger and topic
index views, the ratchet, and the rename planner.

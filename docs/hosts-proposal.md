# One concept for where code runs: the host

Proposed extension, not the current Kit contract. This PR changes no checker, configuration or baseline.
The current contract remains in `spec/`. Read against Kit `a709665`.

## Problem

Five rules and keys answer one question: where does this code run, and what may it touch there?

- `exceptions`;
- `packages[].entrypointExports`;
- `legacy-test-roots`;
- `adapters[].globals`;
- the Window-only rule.

Each answers it for one case, with its own code path in `capability-check.ts`:

- a `host:window` pseudo-capability, derived from a `windowOnly` flag on `lib.dom` types outside the worker types;
- startup files hard-wired to the `shell` and `substrate` zones;
- a separate `entrypointExports` branch in `permits()`;
- `exceptions`, read in two places.

Two real cases still have no answer:

- **A callback serialized into another realm.** A browser-automation `evaluate` callback runs in the page, but
  its globals are charged to the calling module, which never holds that authority. The same shape appears in
  WebDriver `executeScript`, extension scripting and Worker sources.
- **A test seeding platform state in its own realm.** This works only because nothing forbids a second adapter
  for the same global, and nothing documents it.

## The concept

**A host is a runtime environment: the globals that exist there, and the code that starts there.** Every
function body runs in exactly one host. Authority is a pair: a host, and something in it.

1. **Hosts are declared, and their globals come from the compiler.** A host names its library (`dom`,
   `webworker`, `node`, or a package's ambient types). A global exists in a host only if that library declares
   it. The core runs in no host. · {#hosts-are-declared}
2. **A host's globals belong to its adapters.** In each host, one adapter owns each global, and handles reached
   through it are that adapter's. Other code in that host acquires the global only through that adapter. An
   unowned global is a limit. Two hosts may each own the same name. · {#host-globals-have-one-owner}
   This replaces the Window-only rule, `{#host-globals-need-an-adapter}` and `{#declared-globals-cover-their-handles}`.
3. **A host starts at its entries.** An entry is the outermost code of a host program. It may wire the contracts
   of the zones its host permits and use the names the host provides, such as `test` and `expect`. Nothing
   imports it, and it grants nothing to what it imports. Entries are the startup files a host lists, plus every
   claim test as an entry of the proof host, derived from the claim binding. · {#hosts-start-at-entries}
   This replaces `exceptions`, `entrypointExports`, `{#startup-assembles-outer-zones}` and
   `{#entrypoint-package-exports-are-checked}`.
4. **A value of a host's entry type is a program in that host.** A host may name the types that carry code into
   it, such as a browser-automation `PageFunction`. A function literal of that type is checked as an entry of
   that host, and nothing it touches is charged to the caller. It may capture only its parameters, because the
   serialized copy loses everything else; a capture is a finding. The sending call keeps the authority of its
   handle. A reference, `any` or a source string stays a limit. · {#entry-types-carry-code-into-a-host}

Zones stay, because imports point inward. A zone now names its host: core has none, shell has the browser host,
substrate has the server host. "Window authority stays in Shell" follows from claim 2.

## Configuration, before and after

| Today | With hosts |
|---|---|
| `exceptions: [src/startup.ts, oracle/t/x.test.ts]` | `hosts.server.entries: [src/startup.ts]`; claim tests derived |
| `packages[].entrypointExports: [test, expect]` | `hosts.proof.provides: { vitest: [describe, test, expect] }` |
| `legacy-test-roots: [spec/, __tests__/]` | `hosts.proof.roots: [oracle/, spec/, __tests__/]` |
| `adapters[].globals` (one owner across all hosts) | the same row; ownership is per host, taken from the adapter's zone; a proof-root adapter may own the global in the proof host |
| `windowOnly` flag and `host:window` | derived: shell → browser → `lib: [dom]` |
| `adapters[].primitives: [clock, randomness]` | optional: `globals: [Date.now, performance, Math.random, crypto]`, through the same mechanism |
| *(none)* | `hosts.page: { lib: [dom], entered-by: [<package>#PageFunction] }` |

```yaml
hosts:
  browser: { lib: [dom], zone: shell, entries: [src/shell/startup.ts] }
  server:  { lib: [node], zone: substrate, entries: [src/substrate/startup.ts] }
  proof:   { lib: [node], roots: [oracle/], provides: { vitest: [describe, test, expect] } }
  page:    { lib: [dom], entered-by: [playwright#PageFunction, playwright#PageFunctionOn] }
```

## Migration

`kit migrate-config` rewrites a configuration mechanically and never changes a finding key.

1. Make one host per zone in use.
2. Move `exceptions`. Proof-root files drop out, because claim-test entries are derived. Other files go to
   `hosts.<zone>.entries`. Anything it cannot classify is printed.
3. Move `entrypointExports` to `proof.provides`, and `legacy-test-roots` to `proof.roots`.
4. Keep `globals` and `primitives` as they are.

Old keys are read for one release, with a deprecation finding. `raw-primitive` and `ambient-global` keep their
keys, so existing baselines stay valid. The only new findings are captures inside entry-type literals, which
are real bugs.

## Proof cases (source fixtures)

1. A `dom` global in a server-host module gives a finding.
2. That global in a browser composition outside its adapter gives `raw-primitive`.
3. Inside its adapter, it is clean.
4. A proof-root adapter owning `localStorage` in the proof host is clean. A second owner there gives a finding.
5. `evaluate(() => localStorage.getItem("k"))` in a proof helper is clean.
6. The same literal capturing an outer `const` gives a capture finding.
7. A function reference passed to `evaluate` stays a limit.
8. `test` imported in a claim test is clean. In a proof helper, it gives a finding.
9. A startup file wires shell and substrate, and its imports gain nothing.
10. Importing an entry still gives R2 `startup-import`.
11. A migrated configuration gives identical findings on an existing consumer, apart from the deprecation note.

## Trade-offs

- **A new word, for one concept instead of five.** About seven claims become four, and three configuration keys
  leave the vocabulary.
- **Libraries are only as good as the compiler.** Isomorphic code under both `dom` and `node` belongs in the
  core. A mixed-library project becomes a limit rather than a silent pass, which may surface work.
- **Entry types need package typings.** A callback typed `Function` or `string` stays a limit.
- **Two hosts can share a zone,** for example a page and a worker, but they must be named explicitly.
- **Deriving claim tests as entries widens today's opt-in.** That is intended, since the README calls the claim
  test the outer entrypoint, but it is a behaviour change that needs the owner's okay.
- **Not proposed here:** zones are not folded into hosts. They carry the inward-dependency rule, which is about
  architecture, not runtime.

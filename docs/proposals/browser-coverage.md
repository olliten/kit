# Proposal: coverage from browser-run proofs

Status: **design for Olli's approval — 25 November 2026.** Proposed extension, not the current Kit contract.
This PR changes no checker, configuration, claim or baseline. The current contract remains in `spec/`.

## Why

Kit records what each test ran from Node coverage. Code a proof runs inside a browser page reads as unrun, so:

- Leeloo switches `ungoverned-function` and `excerpt-cohesion` off, with the reason "Kit records only Node
  coverage; code run inside the browser page reads as unrun. On again once Kit records browser runs."
- `R4:unreached-module` is static. On 2026-11-24 a claim whose only proof of a placed shell module was a
  Playwright test (`a-read-costs-its-blast-radius.search-idle.browser.test.ts`) failed it, and Leeloo added a
  Node-run proof only to satisfy the check.

The goal: code a browser proof runs counts as run, attributed to that proof, so both rules can come back on and
a browser proof can prove the reach of the modules it names.

## What already exists

Most of the Kit side landed in #89, #91 and the execution-context work; only capture, writer, adoption and
the reach change are missing.

| Piece | Where | State |
|---|---|---|
| Per-test report directory `KIT_COVERAGE/<encoded test>/`; several LCOV files there combine for that test only | `verify-run`, `test-runs` | landed |
| A group's `contexts: [browser]`; a missing or malformed `browser-context.json` makes the test's context incomplete | `#required-runtime-contexts-are-captured` | landed |
| `KIT_TEST`, `KIT_RUNTIME`, `KIT_FUNCTIONS` (the compiler's named functions, with source offsets) in the test's environment | `verify-run`, `read-recorder` | landed |
| Merge of a supplemental context with Node loads; foreign runtime or incomplete capture can't be repaired by Node | `execution-context` | landed |
| Independent credit: complete context, no bootstrap among loaded sources, every loaded path an original source | `independent-runs` | landed |
| Source-map decoding and attribution of V8 function ranges to compiler function spans, giving LCOV + loaded + complete | `browser-function-evidence` (#89) | landed, unused |
| Owned browser launch with observed version and executable digest | `browser-runtime` (#91) | landed, unused |
| Exact public subpath package contracts, so `kit/browser` can be classified alone | `#entrypoint-package-exports-are-checked` (D1) | landed |
| Map artifact v1 `scripts: [{scriptHash, base, map}]` | `browser-sdk-handoff.md` | format approved |
| Capture in the page, writer, public entry, app adoption, runtime reach | — | **this proposal** |

## 1. Capture

V8 precise coverage through CDP, function granularity, per page:

1. Before the page loads app code: `Profiler.enable`, then
   `Profiler.startPreciseCoverage({callCount: true, detailed: false})`. Function counts are Kit's grain (named
   functions); block coverage costs more and adds nothing a rule reads.
2. After the proof's last step, before the page or context closes: `Profiler.takePreciseCoverage` and, for each
   script, `Debugger.getScriptSource` (or Playwright's `page.coverage`, which wraps both for Chromium and returns
   each script's source). Coverage accumulates across navigations (`resetOnNavigation: false`).

Kit owns this, not the app: the capture attaches to a Playwright `BrowserContext` the harness passes in, starts
coverage on every page already open and on each page the context opens later, and takes it from each before it
closes. Chromium only; another browser type is an incomplete context, never Node-only proof.

Lifecycles that fail closed (the context is written with `complete: false`):

- a page closed, crashed or navigated to a new process before its coverage was taken;
- a dedicated or shared worker, service worker or out-of-process frame that loads a script matching the map
  (see 2). v1 does not capture them; a proof whose code runs there gets no credit rather than wrong credit;
- a script the page ran whose served bytes match no map entry and whose URL is not declared external (see 4);
- any mapping failure `browser-function-evidence` already reports.

Anonymous scripts that match no map entry, which is what `page.evaluate` glue from the test is, are ignored.
That is a checker limit: a source function serialized into the page through `page.evaluate(fn)` runs without
a map and reads as unrun.

## 2. Mapping to source files and functions

The served bytes are matched to their map by `scriptHash` (SHA-256 of the exact bytes the page ran, from the
coverage's own script source), never by URL, so content-hashed names (`app.<hash>.js`), inline scripts and
scripts injected by content all match the same way. Each covered function's first range is mapped:

1. its generated start offset → the original position of the mapping segment at that offset;
2. that position → the smallest compiler function span (`KIT_FUNCTIONS`) holding it, in that original source;
3. the span's `name@line` gets the range's count, as the LCOV `FN`/`FNDA` Kit already reads.

Change to #89's attribution: today a function's start takes the nearest preceding segment. A bundler that
reorders code can make that segment belong to an unrelated function, crediting code that never ran. v2 takes
only a segment inside the function's own generated range `[startOffset, endOffset)`, at or before its first
nested function; none there makes the context incomplete. The other way round, a function a minifier inlined
has no V8 function of its own and reads as unrun: a missed run is a finding, never an exemption.

`loaded` is the set of original sources the matched maps name, less `node_modules` and declared externals.
A source outside the app root, a map source with no file, or a file whose bytes differ from what the map
describes makes the context incomplete. The writer reads every original source it maps, in the Node process,
so the read recorder holds those files in the test's pass (see 5).

**What the app provides:** a test build whose served scripts carry source maps, and the map artifact.

- Maps with `sources` resolvable against `base` (root-relative); `sourcesContent` is not needed, Kit reads the
  files.
- Unminified, or at least without syntax minification. Identifier mangling is harmless, since attribution
  uses positions, not names; syntax minification and inlining cost coverage, as above. Leeloo's
  `scripts/build-client.mjs` needs a test mode: esbuild `sourcemap: 'external'`, `minify: false`, otherwise the
  production bundle.
- The map artifact v1, one JSON file per build: `{version: 1, scripts: [{scriptHash, base, map}],
  external?: [urlPrefix]}`, where `map` is the root-relative path of the map file. A per-proof bundle, such as
  `pageRealm` builds, adds its entries to the same artifact or writes its own beside it.

## 3. Merge with Node coverage and proof binding

Nothing new is merged by hand. The writer puts two files in `KIT_COVERAGE/<encodeURIComponent(KIT_TEST)>/`:

- `browser.info`: the LCOV `browser-function-evidence` builds, in original root-relative paths. `testRuns`
  already combines every LCOV report in the test's own directory, so the pass's `ran` is Node ∪ page, per
  function, for that test alone; sibling and chunk-wide reports still grant nothing.
- `browser-context.json`: `{complete, loaded, runtime: KIT_RUNTIME, browser: {version, executableDigest}}`.
  `executionContext` already merges it with Node's loads and fails the whole context when it is incomplete or
  its runtime differs. `browser` is recorded for diagnosis.

Binding is unchanged: evidence is keyed by `KIT_TEST`, the test file, which the read recorder sets in each
forked worker; a claim's tests are its anchor's files. So a browser proof's runs are its claim's, exactly as a
Node proof's are.

Independence is unchanged and decides what a browser proof can credit:

- A proof whose page loads the whole app bundle loads the app's client bootstrap among its sources. It keeps
  integration evidence (its runs count for reach, see 6) but grants no independent execution credit, as an
  application journey in Node does today.
- A proof whose page loads a bundle whose entry is the test, or a placed oracle module (what `pageRealm`
  does), and no bootstrap, qualifies. These are the proofs that make `ungoverned-function` and
  `excerpt-cohesion` meaningful for shell code.

The browser group declares `contexts: [browser]`, so a browser test that never wrote its capture is
incomplete, not a Node-only proof.

## 4. The harness contract

A public entry, `kit/browser`, registered as its own exact package contract
(`{name: kit/browser, capabilities: [browser-driving, filesystem]}` in the app's config, under D1). Its whole
surface:

```ts
import { browserProof } from "kit/browser";

const proof = await browserProof(context, { maps: "public/generated/kit-map.json" });
// … the test drives its pages …
await proof.done(); // takes coverage from every page, maps it, writes both files
```

- `browserProof(context, {maps})` starts capture on the given Playwright `BrowserContext` (Chromium), reading
  `KIT_COVERAGE`, `KIT_TEST`, `KIT_RUNTIME` and `KIT_FUNCTIONS` from the environment. Outside `kit verify`, with
  none of them set, it does nothing and `done()` returns.
- `done()` is called once, in the test's `afterEach`/`afterAll`, before the context closes. Never calling it
  leaves no file and the required context is incomplete.
- The app owns its bundle and its map artifact; Kit owns capture, attribution and the files' format. The two
  files are Kit's, not part of the contract, so their format can change under the recording format.

`playwright-core` stays an optional peer dependency. Launching through `browserRuntime` stays optional; the
app's own Playwright launch works.

## 5. Pass reuse

- A browser test's pass holds the files the writer read: the map artifact, the maps and every original source
  it mapped, whole. An edit to any page source in the bundle reruns every
  proof whose page loaded that bundle. The finer "code it ran" holding (`#a-pass-holds-while-the-code-it-ran-holds`)
  stays Node-only for now; it could later apply to mapped sources.
- The bundle must be built before or inside the test from files the recorder sees. A bundle built by a step
  outside `kit verify` is held through its own bytes and the map artifact, so the sources still rerun the test
  through the map.
- The browser binary is outside the app, so the recorder never sees it. The pass holds `playwright-core`,
  which pins the Chromium revision Playwright installs; a browser installed or pointed to otherwise is a limit.
- `RECORDING_FORMAT` goes to 3, since a pass's `ran` and context gain page evidence; every pass runs once more.

## 6. Reach

`#proofs-reach-named-modules` is static today. Proposed: a claim also reaches a named placed module when a test
of that claim, whose pass holds, ran a named function of it in a complete context, browser or Node,
independent or not. Reach is use; independence is a separate question the run rules ask.

- While such a test has no pass that holds, its claim's `unreached-module` findings that static reach can't
  settle wait, as the run rules do, and `kit check` says so. A standalone `kit check` never fails a claim that
  `kit verify` would pass.
- Runtime reach is not charged to `#proofs-reach-only-named-modules`: a journey runs most of the app, and
  naming all of it is not what that claim means. Only static reach stays exact. `claim-cohesion` stays static.

## Cost

Estimated, to be measured on Leeloo before the rules switch on:

- Precise function-level coverage slows page code by roughly 5–15%; block coverage, which this doesn't use, is
  costlier.
- Mapping: decoding a full-app map is roughly 0.2–1 s per test file, each in its own fork. The writer may keep a
  decoded map per `scriptHash` under the invocation's directory so a chunk decodes each map once.
- Artifacts: `browser.info` holds one `FN`/`FNDA` pair per function of each loaded source, perhaps 100–300 KB for
  a full-app bundle, discarded after the run; a pass keeps only the ran functions and loaded paths, in the tens
  of KB. Raw V8 coverage is not kept.
- An unminified test bundle is larger to serve, which is negligible locally.

## Limits

Stay checker limits, stated in the claims:

- code in workers, service workers and out-of-process frames (v1 fails closed when app code runs there);
- source functions serialized through `page.evaluate`;
- functions a bundler inlined or removed;
- code that runs only sometimes, such as idle callbacks, timers and races: a function a proof runs only on some
  runs makes its findings vary. The capture is faithful; the proof should await what it claims.
- a browser other than the one `playwright-core` pins; non-Chromium browsers.

## Rules that come back on

In Leeloo, after it moves its pin and adopts the harness:

- `ungoverned-function` and `excerpt-cohesion`: remove both `rules: off` rows. Expect the baseline to change
  once: page functions now run by qualifying proofs drop out, and functions run only by full-app journeys,
  which grant no independent credit, appear as debt to pay with `pageRealm` proofs or name differently.
  `kit check --tighten` records the change.
- `R4:unreached-module` for the search-idle claim: settled by the browser proof; the Node proof added on
  2026-11-24 may be kept or removed on its own merits.

## Spec changes (phase 1, after approval)

| Topic | Claim | Change |
|---|---|---|
| `proof.md` | `#execution-context-is-attributable` | Add the capture lifecycle, script matching by hash, the in-range segment rule, fail-closed workers and frames, ignored anonymous glue, and the recorded browser identity. |
| `proof.md` | `#proofs-reach-named-modules` | Add runtime reach from a holding pass, and its wait. |
| `proof.md` | `#proofs-reach-only-named-modules` | State that runtime reach is not charged. |
| `proof.md` | `#runs-are-kept-with-each-pass` | Page coverage written beside Node's counts as the test's. |
| `verification.md` | new `#browser-proofs-record-their-runs` | The `kit/browser` entry: inputs, the two files, nothing outside `kit verify`. |
| `verification.md` | new `#a-browser-map-names-served-scripts` | The map artifact v1 and its validation. |
| `verification.md` | `#passes-are-kept-under-the-recording-format` | Format 3; browser sources held whole; the browser binary limit. |
| `terms.md` | new modules | `browser-capture` (substrate adapter, browser-driving: CDP sessions per page), `browser-map` (core reading: artifact v1 and hash matching), `browser-proof` (substrate composition: the public entry and writer), `runtime-reach` (core reading). |
| `self-config.md` | registrations | `browser-capture` adapter; `package.json` `exports` gains `./browser`. |
| `reference.md` | docs | A harness section: the build mode, the map artifact, the two calls. |

## Decisions for Olli

1. **Capture owner.** Kit captures through a public `kit/browser` entry the harness calls (proposed), rather than
   the app capturing and writing Kit's files itself.
2. **Fail closed** on workers, service workers, out-of-process frames and unmatched non-anonymous scripts in v1
   (proposed), rather than ignoring them.
3. **Journeys stay non-independent.** A page that loads the app bootstrap grants reach and integration
   evidence only (proposed, the current rule), so Leeloo's code run only by full-app journeys becomes debt.
4. **Runtime reach** satisfies `unreached-module` and waits without a pass (proposed), and is not charged to
   `proofs-reach-only-named-modules`.
5. **Browser identity** through the held `playwright-core` package (proposed), rather than a held digest of
   the executable, which is machine-specific and would stop sharing passes across machines.

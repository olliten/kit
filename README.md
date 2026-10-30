# Kit

Architecture as a check, for codebases that agents write.

## Why

Most conventions in a codebase exist so a person can read it. Agents don't read that way: an agent starts each
task with no memory of the codebase and finds code by searching. What agents tell each other isn't in the repo
for the next one.

Agents drift in a specific way. An agent solves the task in front of it. It doesn't know the codebase has a word
for the thing, so it adds a second word. It doesn't know a function already does this, so it adds a wrapper. Each
choice is defensible alone. Together they are two names for one concept, two paths to one effect, and indirection
nobody designed. The next agent reads that and understands less. With several agents at once, this compounds.

A document doesn't prevent it: the first app Kit was written for had the architecture in its instructions, and
its agents drifted anyway. A check prevents it, if it runs on every change and fails the one that starts the
drift. That is Kit. A person decides what the product promises and what the words mean, in the spec. Agents write
the code. The check keeps the two consistent.

The same structure is what lets agents work in parallel. One module per file and one test file per claim mean
two tasks on different claims edit different files. Effects behind adapters mean a module's imports and the
contract types it takes show every effect it can cause, so an agent can change one module knowing what else it
can affect. And a headless core means most tests run in a plain process, so every agent's change goes through the
gate without waiting on the others.

## Humans and agents

| What a developer does | A person | An agent | So Kit makes the codebase | What that costs |
|---|---|---|---|---|
| **Reads** code | Opens a file and scrolls. Prefers a feature on one screen | Starts with no memory. Searches, opens the few files the task needs, ignores the rest | One module per file, hundreds of files | A person reads this codebase worse than a conventional one |
| **Places** a module | Picks the folder it belongs to. A shared module belongs to several, so it ends up in `utils/`, and the tree stops meaning anything | Picks the folder that looks right for this task. Another agent, another task, picks another | The path answers one question only, what the module may do: `src/<zone>/<layer>/<name>.ts`. Twelve folders, the same in every app | The tree says nothing about features |
| **Groups** modules into a feature | The folder tree, decided once, reorganised at great cost | Nothing. It sees files, not features | A topic states one feature's claims, and each claim names the modules it depends on, from any zone | Regrouping is a spec edit, which a person ratifies |
| **Finds** where things live | Browses the tree | Searches a name | The path follows from the role; `kit refs` lists the claims a module keeps | Names must be true, or search finds nothing |
| **Remembers** the design | In their head since last month; docs are a reminder | Nothing between sessions. A doc not read this time doesn't exist | Everything that matters is in the repo, in a form the check reads: topics, terms, claims | The spec is the design. Cut it badly and the check enforces that |
| **Decides** a change | Sees the whole; bends a rule when it makes sense | Sees the task; can't tell deliberate structure from accident | Decisions live in a core with no effects, where a check can see them. Rules are absolute | No exceptions; changing a rule means changing Kit |
| **Proves** a change works | Runs the suite before pushing; tolerates a slow one | Runs it on every change, many times an hour. How long the suite takes sets how fast everything merges | Decisions in a headless core, so most tests run in a plain process. The browser covers only the shell | Browser and transport are still proved, separately and less often |
| **Reviews** work | Reads the diff | Writes faster than anyone can read | The person reviews the spec: promises and words. The check reviews the code | Quality below the claim goes unreviewed |
| **Works alongside** others | A few people, who share a running picture of the code | Many at once, each with its own picture; a conflict is a failed merge | Two tasks on different claims edit different files | Real only once the check runs in CI |
| **Lives with** the codebase | It degrades slowly, and someone refactors | It degrades at the rate it's changed, and no agent is in a position to see that | A change that would degrade it fails | A rule an agent can't satisfy stops it until a person rules |

## Working in two phases

**Phase 1, the plan, is serial and a person reviews it.** It edits only the shared files:

- the topic: the claims, and the modules each claim names;
- `spec/terms.md`: a line for each new module, with its role and zone;
- contract types in `primitives`, so a test and a module can be written against the same signatures;
- adapter registrations in `kit/config.md`, since which effects exist is a design decision.

The reviewer also judges granularity. When a claim names a module that other claims already name, ask whether
it needs the same code or a different part of it; a different part is a new module, planned now. `kit refs`
shows which claims a module already keeps.

**Phase 2, the work, is parallel.** Each agent writes one claim's test file or one term's module. Paths follow
from the plan: `oracle/<topic>/<anchor>.test.ts` and `src/<zone>/<layer>/<term>.ts`. Two agents never edit the
same file. A phase-2 change that needs to edit a shared file means the plan was incomplete: it goes back to
phase 1.

## Topics

A topic is one file in `spec/`, usually one thing a user does: a title, an intro of at most three sentences, then
sections and claims. Each claim names the modules that implement it and the shared test modules that prove it:

```markdown
# Review an article

A reviewer reads each waiting reading and accepts or declines it.

## Declining

- A decline cannot be saved without a reason in the reviewer's own words. · {#decline-needs-reason}
  - Implementation: {{decline}}, {{surface}}
  - Proof: {{decline-cases}}
```

Each `{{term}}` is defined once in `spec/terms.md` and bound to one file. The anchor binds the claim to
`oracle/review-an-article/decline-needs-reason.test.ts`. A claim with no test, a test that names no claim, a
module no claim names, a named module its tests don't reach, prose outside a claim: each fails. So a topic is a
map of its feature that the check keeps accurate.

The reverse view is derived, never written into the module: `kit refs src/shell/adapters/surface.ts` lists every
claim that names it, with its tests. Run as a Claude Code read hook, it adds that list to what an agent sees when
it opens the file.

## A feature

An agent gets the task *decline a whole article with one reason*.

1. **Plan.** It adds one claim to `spec/review-an-article.md`, naming the modules it depends on, and a terms line
   for each new module. A person reviews this diff: it is the design.
2. **Work, in parallel.** One agent writes `oracle/review-an-article/decline-whole-article.test.ts`, the
   definition of done. Another writes `src/core/compositions/decline-article.ts`. The core is pure, so the test
   runs without a browser.
3. **Gate.** `kit check` exits 0 and the tests pass.

## The rules

**R1, zones and layers.** Code lives in three zones:

- `core` decides and performs no effect.
- `shell` renders and turns input into data. Window-only host authority stays here.
- `substrate` does I/O.

Each zone has four layers:

- `primitives`: types and constants.
- `readings`: facts derived from data, with no effects.
- `adapters`: one external capability each, behind a plain contract.
- `compositions`: the others wired into behaviour.

Authority is structural:

- Only a registered adapter creates authority, and only it constructs values of its contract.
- The core and readings take data. Behaviour (a callback, an accessor, an object with operations) crosses into
  them only as a registered adapter's contract, whose capability the zone rules check.
- Behaviour moves freely only between the compositions and adapters of one zone.

So a module's imports and the contract types it takes say every effect it can cause.

**R2, dependencies.**

- Primitives import primitives.
- Readings import primitives and readings.
- Adapters import only primitive data contracts.
- Compositions may import all four.
- Across zones, imports point inward to the core.
- No cycles.

**R3, names and comments.**

- Every placed module is a term defined once in `spec/terms.md`, with its role and zone.
- Every comment says only why.

**R4, proof.**

- A topic is a title, a short intro, sections and claims; nothing else.
- Every claim has a test, and the code its tests use reaches the modules it names.
- Every test names a claim, and every placed module is named by a claim.
- Two claims that share no code share no module: if the claims naming a module use disjoint parts of it, split it.
- With what each test ran (kept by `kit verify`), every named function is run by a claim that names its module, and a module
  holding code that only one claim runs, for two or more claims, is split along those claims.

**Legacy.** Existing code is legacy until it's moved into place. Its findings are debt that may only shrink, and
so is its size: a change may add to a legacy module only calls into placed modules. Legacy and declared
entrypoints hand placed code data or an adapter's contract, never other behaviour.

A change that breaks a rule fails the check.

## The shape

```
spec/
  terms.md                     every word, defined once
  review-an-article.md         one topic per feature: its claims, which name its modules
src/
  core/      {primitives, readings, adapters, compositions}/<name>.ts
  shell/     {primitives, readings, adapters, compositions}/<name>.ts
  substrate/ {primitives, readings, adapters, compositions}/<name>.ts
oracle/
  review-an-article/<anchor>.test.ts    one file per claim
kit/
  config.md                    the app's declarations
  debt/legacy/                 what isn't placed yet, one file per path; only shrinks
```

## Adopt

```sh
git clone <this repo> ../kit && (cd ../kit && npm install)
```

Add `kit/config.md` mapping your folders to zones, `spec/terms.md` with your domain's words, and a baseline of
today's findings and legacy sizes. Run `kit check` in CI. It fails on debt the baseline still holds once paid, so a
change that pays debt or shrinks a module runs `kit check --tighten` and commits the smaller baseline. For the read hook, point a `PostToolUse` hook on `Read` at
`kit-refs.mjs --hook --root . --config kit/config.md`.

Everything `kit/config.md` can declare, such as several code roots, entrypoints, package contracts, dependency
exclusions and legacy locations, is in [`docs/reference.md`](docs/reference.md). The method itself, independent of
TypeScript, is in [`docs/method.md`](docs/method.md).

## This repository

Kit is written in its own structure and checks itself, with no legacy baseline and no checker limits: its
launchers in `scripts/` are declared entrypoints of a few lines each, and everything they run is placed. Rules:
`spec/`. Reasons: `docs/decisions.md`. `npm test`,
`npm run check`, `npm run refs -- <module>`, and `npm run consumers -- ../app …` to see what a change to Kit means
for each app that uses it.

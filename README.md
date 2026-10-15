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

## Humans and agents

| What a developer does | A person | An agent | So Kit makes the codebase | What that costs |
|---|---|---|---|---|
| **Reads** code | Opens a file and scrolls. Prefers a feature on one screen | Starts with no memory. Searches, opens the few files the task needs, ignores the rest | One module per file, hundreds of files | A person reads this codebase worse than a conventional one |
| **Places** a module | Picks the folder it belongs to. A shared module belongs to several, so it ends up in `utils/`, and the tree stops meaning anything | Picks the folder that looks right for this task. Another agent, another task, picks another | The path answers one question only, what the module may do: `src/<zone>/<layer>/<name>.ts`. Twelve folders, the same in every app | The tree says nothing about features |
| **Groups** modules into a feature | The folder tree, decided once, reorganised at great cost | Nothing. It sees files, not features | A topic names the modules of one feature, from any zone. A module appears in every topic that uses it. The check keeps each reference true | Regrouping is a spec edit, which a person ratifies |
| **Finds** where things live | Browses the tree | Searches a name | The path follows from the role; the topic lists the rest | Names must be true, or search finds nothing |
| **Remembers** the design | In their head since last month; docs are a reminder | Nothing between sessions. A doc not read this time doesn't exist | Everything that matters is in the repo, in a form the check reads: topics, terms, claims | The spec is the design. Cut it badly and the check enforces that |
| **Decides** a change | Sees the whole; bends a rule when it makes sense | Sees the task; can't tell deliberate structure from accident | Decisions live in a core with no effects, where a check can see them. Rules are absolute | No exceptions; changing a rule means changing Kit |
| **Writes** it down | Prose costs time, so comments, specs and tests stay thin | Writing is free; it produces a definition and a test for anything | Every module has a heading and a term; every claim has a test | Each sentence lands on the person who ratifies it |
| **Proves** a change works | Runs the suite before pushing; tolerates a slow one | Runs it on every change; with many agents, many times an hour. How long the suite takes sets how fast everything merges | Decisions in a headless core, so most tests run in a plain process in seconds. The browser covers only the shell | Browser and transport are still proved, separately and less often |
| **Reviews** work | Reads the diff | Writes faster than anyone can read | The person reviews the spec: promises and words. The check reviews the code | Quality below the claim goes unreviewed |
| **Works alongside** others | A few people, who share a running picture of the code; conflicts settled in review | Many at once, each with its own picture; a conflict is a failed merge | Two tasks on different modules edit different files: one file per module, one test file per claim, effects behind adapters | Real only once the check runs in CI |
| **Lives with** the codebase | It degrades slowly, and someone refactors | It degrades at the rate it's changed, and no agent is in a position to see that | A change that would degrade it fails | A rule an agent can't satisfy stops it until a person rules |

## Topics

A folder tree asks where a module belongs, and a shared module belongs in several places. Whichever you pick,
the other features import it from across the tree, and the tree stops describing the features. Kit separates
the two questions. Where a module lives is answered by what it may do, `src/<zone>/<layer>/<name>.ts`,
once and mechanically. What it's for is answered by topics, and a topic can name any module.

The spec is a set of topics, one file each, usually one thing a user does. A topic names the modules that
implement it and states its claims:

```markdown
# Review an article

### shell/adapters/surface
Draw on the page and report input as plain presses.

- A decline cannot be saved without a reason in the reviewer's own words. · {#decline-needs-reason}
```

The heading binds a module to `src/shell/adapters/surface.ts`. The anchor binds a claim to
`oracle/review-an-article/decline-needs-reason.test.ts`. A heading with no file, a claim with no test, a test
that names no claim: each fails. So a topic is a map of its feature that the check keeps accurate: what it
promises, what implements it, what proves it. The files under `src/` don't show which feature they belong to;
the topic does.

## A feature

An agent gets the task *decline a whole article with one reason*.

1. It opens `spec/review-an-article.md` and reads its claims and the modules it names. Nothing else.
2. It adds one claim: `- A reviewer may decline every waiting reading of an article with one reason. ·
   {#decline-whole-article}`. For a new module it adds a heading and a terms line. This diff is the design.
3. It writes `oracle/review-an-article/decline-whole-article.test.ts`. That is the definition of done.
4. It writes the module at `src/core/compositions/decline-article.ts`. The core is pure, so the test runs in
   milliseconds without a browser. An effect it lacks is a finding naming the adapter to declare.
5. `kit check` exits 0 and the tests pass. The person reviews the claim in the spec diff.

## The rules

**R1, zones and layers.** Code lives in three zones:

- `core` decides and performs no effect.
- `shell` renders and turns input into data.
- `substrate` does I/O.

Each zone has four layers:

- `primitives`: types and constants.
- `readings`: facts derived from data, with no effects.
- `adapters`: one external capability each, behind a plain contract.
- `compositions`: the others wired into behaviour.

So the core is headless: its decisions run in a plain process. That is where most tests live, and why the gate
stays short enough to run on every change. And every effect has exactly one adapter it happens in.

**R2, dependencies.**

- Primitives import primitives.
- Readings import primitives and readings.
- Adapters import only primitive data contracts.
- Compositions may import all four.
- Across zones, imports point inward to the core.
- No cycles.

So a module's imports say exactly what it can reach, and changing a module can't affect anything below it.

**R3, names and comments.**

- Every placed module is a term defined once in `spec/terms.md`, with its role and zone.
- Every comment says only why.

So a word means one thing everywhere, a path says what a module may do, and the code never restates or
contradicts the spec.

**R4, proof.**

- Every claim in the spec has a test.
- Every test names a claim.

So the spec is only promises that are proved, and no test exists without saying what it proves.

A change that breaks a rule fails the check. Existing code is legacy until it's moved into place; its findings
are debt that may only shrink.

## Headless and modular

*Headless*: the core runs without the browser, the network or storage. All of its logic is proved in a plain
process, so the gate is seconds, not minutes, and runs on every change from every agent.

*Modular*: one module per file, imports one way, each effect behind one adapter with a plain contract. A change's
reach is known from its imports, so agents can change modules at the same time without reading each other's work.

Kit enforces both. It doesn't decide whether the modules are the right ones. That's the spec, and a person
ratifies it.

## The shape

```
spec/
  terms.md                     every word, defined once
  review-an-article.md         one topic per feature: its modules, its claims
  research-a-client.md
src/
  core/      {primitives, readings, adapters, compositions}/<name>.ts
  shell/     {primitives, readings, adapters, compositions}/<name>.ts
  substrate/ {primitives, readings, adapters, compositions}/<name>.ts
oracle/
  review-an-article/<anchor>.test.ts    one file per claim
  research-a-client/<anchor>.test.ts
kit/
  config.md                    the app's declarations
  debt/legacy.json             what isn't placed yet; only shrinks
```

## Adopt

```sh
git clone <this repo> ../kit && (cd ../kit && npm install)
```

Add `kit/config.md` mapping your folders to zones, `spec/terms.md` with your domain's words, and a baseline of
today's findings. Run `kit check` in CI. Nothing users see changes.

## This repository

Kit is written in its own structure and checks itself. Rules: `spec/`. Reasons: `docs/decisions.md`. `npm test`,
`npm run check`.

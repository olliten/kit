# Kit

Architecture as a check, for codebases that agents write.

## Why

Every convention in a normal codebase exists because a person has to read it. Big files, feature folders, code
review, asking whoever wrote the billing module: each one fits the code into a human head. Agents have no head to
fit it into. They start every task knowing nothing, read by searching, and never talk to each other.

So agents fail in their own way. An agent solves the task in front of it. It doesn't know the codebase already has
a word for the thing, so it adds a second one. It doesn't know a function already does this, so it adds a wrapper.
It can't tell whether the structure it is about to cut across was deliberate, so it works around it. Each choice is
reasonable alone. Together they are three names for one concept, two paths to one effect, and a layer of
indirection nobody designed. The next agent reads that, understands less, and makes more of the same choices. A
person who hits the second name eventually unifies it, out of irritation. An agent adapts. Ten agents in parallel
produce ten dialects in a week.

Kit refuses the drift at the change that starts it. A new word must be a term defined once, so a synonym fails. A
module must be a declared concept at one path, so a parallel path fails. A decision outside the core, an effect
outside an adapter, an import pointing the wrong way: each fails, and the finding names the fix. The person decides
what the product promises and what words mean. Agents build. The check binds the two.

## Humans and agents

| What a developer does | A person | An agent | So Kit makes the codebase | What that costs |
|---|---|---|---|---|
| **Reads** code | Opens a file and scrolls. Wants a feature on one screen, in one head | Starts with no memory. Greps, opens the three files it needs, ignores the rest | One module per file, hundreds of files | A person opening it sees fragments |
| **Finds** where things live | Browses the tree; folder names carry the meaning | Searches a name; the file name and path are what it reads | Twelve fixed folders, `src/<zone>/<layer>/`. The path says what code may do; a topic says what it is for | Names must be true, or search finds nothing |
| **Remembers** the design | In their head since last month; docs are a reminder | Nothing between sessions. A doc not read this time does not exist | Everything that matters is in the repo, in a form the check reads: topics, terms, claims | The spec is the design. Cut badly, the check enforces that |
| **Decides** a change | Sees the whole; bends a rule when it makes sense | Sees the task; cannot tell deliberate structure from accident | Decisions live in a core with no effects, where a check can see them. Rules are absolute | No exceptions; changing a rule is a change to Kit |
| **Writes** it down | Prose costs time; comments, specs and tests stay thin | Writing is free; will produce a definition and a test for anything | Every module has a heading and a term; every claim has a test | Each sentence lands on the person who ratifies it |
| **Reviews** work | Reads the diff | Writes faster than anyone can read | The person reviews the spec: promises and words. The check reviews the code | Quality below the claim goes unreviewed |
| **Works alongside** others | A few people, talking; conflicts settled in review | Many at once, not talking; a conflict is a failed merge | Nothing to collide on: one file per module, one test file per claim, effects behind adapters | Real only once the check runs in CI |
| **Lives with** the codebase | It degrades slowly; someone refactors | It degrades at the rate it is changed; nobody notices | Each change that would degrade it fails | A rule an agent cannot satisfy stops it until a person rules |

## A feature

An agent gets the task *decline a whole article with one reason*.

1. It opens `spec/review-an-article.md` and reads its claims and the modules it names. Nothing else.
2. It adds one claim: `- A reviewer may decline every waiting reading of an article with one reason. ·
   {#decline-whole-article}`. For a new module it adds a heading and a terms line. This diff is the design.
3. It writes `oracle/review-an-article/decline-whole-article.test.ts`. That is the definition of done.
4. It writes the module at `src/core/compositions/decline-article.ts`. The core is pure, so the test runs in
   milliseconds without a browser. An effect it lacks is a finding naming the adapter to declare.
5. `kit check` exits 0 and the tests pass. The person reads one sentence in the spec diff and says yes.

## Topics

The spec is a set of topics, one file each, usually one thing a user does. A topic names the modules that
implement it, across all zones, and states its claims:

```markdown
# Review an article

### shell/adapters/surface
Draw on the page and report input as plain presses.

- A decline cannot be saved without a reason in the reviewer's own words. · {#decline-needs-reason}
```

The heading binds a module to `src/shell/adapters/surface.ts`. The anchor binds a claim to
`oracle/review-an-article/decline-needs-reason.test.ts`. A heading with no file, a claim with no test, a test that
names no claim: each fails. So a topic is always a true map of its feature: what it promises, what implements it,
what proves it. A module has one home in `src/` and may appear in any number of topics.

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

So every decision is a reading or a core composition and tests without a browser, a network or storage, and every
effect has exactly one adapter it happens in.

**R2, dependencies.**

- Primitives import primitives.
- Readings import primitives and readings.
- Adapters import only primitive data contracts.
- Compositions may import all four.
- Across zones, imports point inward to the core.
- No cycles.

So a module's imports say exactly what it can reach, and changing a module cannot affect anything below it.

**R3, names and comments.**

- Every placed module is a term defined once in `spec/terms.md`, with its role and zone.
- Every comment says only why.

So a word means one thing everywhere, a path says what a module may do, and the code never restates or
contradicts the spec.

**R4, proof.**

- Every claim in the spec has a test.
- Every test names a claim.

So the spec is only promises that are proved, and no test exists without saying what it proves.

A change that breaks a rule fails the check. Existing code is legacy until it is moved into place; its findings
are debt that may only shrink.

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
  debt/legacy.json             what is not placed yet; only shrinks
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

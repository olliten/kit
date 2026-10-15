# Kit

Architecture as a check, for codebases that agents write.

Kit holds a TypeScript app to one structure: decisions in a pure core, every effect behind an adapter, every word
defined once, every promise in the spec proved by a test. `kit check` fails any change that breaks it.

## Why

Agents keep the rules that are checked. A document is read once per session; a check runs on every change. Kit
turns the architecture into checks, so the code converges on the design instead of drifting from it.

The person stays in control of the codebase by ratifying sentences, not by reading diffs. Topics, claims, terms
and module headings are the design. The checker makes the code match them.

Agents work in parallel because nothing is shared. One module per file, one test file per claim, one topic per
feature. Tasks on different topics touch different files, need no memory of each other, and are judged the same
way by the same check.

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
`oracle/review-an-article/decline-needs-reason.test.ts`. Kit fails a heading with no file, a claim with no test,
and a test that names no claim. So a topic is always a true map of its feature: what it promises, what implements
it, and what proves it. Reading one topic is reading the whole feature; reading nothing else is enough.

Folders say what code may do. Topics say what it is for. A module has one home in `src/` and may appear in any
number of topics.

## A feature

1. Read the topic. Open only the modules it names.
2. Propose the change as spec: a claim with an anchor, and for a new module its heading and terms line. This diff
   is the design review.
3. Write the claim's test. That is the definition of done.
4. Write the module in its own file at `src/<zone>/<layer>/<name>.ts`. Core modules are pure and test in seconds
   without a browser. An effect you lack is a finding that names the adapter to declare.
5. `kit check` exits 0; the tests pass. The pull request's footprint is its spec diff.

## The structure

| Zone | May | May not |
|---|---|---|
| `core` | decide | perform any effect |
| `shell` | render, turn input into data | decide a domain fact |
| `substrate` | store, send, call out | hold a domain rule |

In each zone: `primitives` (types, constants), `readings` (pure derivations), `adapters` (one host capability
each, behind a plain contract), `compositions` (wiring). Imports point down the layers and inward to core.
Existing code is legacy until it is moved into place; its findings are recorded as debt that may only shrink.

## Adopt

```sh
git clone <this repo> ../kit && (cd ../kit && npm install)
```

Add `kit/config.md` mapping your folders to zones, `spec/terms.md` with your domain's words, and a baseline of
today's findings. Run `kit check` in CI. Nothing users see changes.

## This repository

Kit is written in its own structure and checks itself. Rules: `spec/`. Reasons: `docs/decisions.md`. `npm test`,
`npm run check`.

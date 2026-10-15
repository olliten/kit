# Kit

Kit checks a TypeScript codebase written mostly by AI agents. It keeps the code in one structure: decisions run
headless, effects go through named adapters, names come from one vocabulary, and every claim in the spec is proved
by a test. Kit is built with its own model and checks itself.

## Why it exists

1. **Agents follow what is checked, not what is written down.** An agent arrives with no memory, reads the
   instructions once and makes a reasonable-looking change. Done thousands of times, that produces 3,000-line
   files, import cycles, effects inside "pure" code and state written from everywhere. That happened in the first
   app Kit was built for, under good instructions. Kit turns the architecture into checks that every change must
   pass, so the code converges on the structure instead of drifting from it.
2. **Many agents can only work in parallel if the codebase is divisible.** Agents do not coordinate by talking.
   They coordinate through structure: one concept per file, one test file per claim, topics with clear boundaries,
   and one named adapter per effect. Then they can work side by side without colliding, and each can start cold
   and read only what its task needs.

What follows from those two:

- **Headless and heavily tested.** Domain decisions live in a core that performs no effects, so most behaviour is
  proved in fast tests without a browser, a network or storage. Every effect goes through an adapter, so every
  effect can be faked.
- **Every promise is proved.** Each claim in the spec has a stable anchor and at least one test named after it.
  Kit fails a claim with no test and a test that names no claim.
- **Cheap to read.** A file's path says what it may do. Feature-sized topics mean an agent reads one topic, not
  the whole spec. A word means one thing everywhere.
- **Human attention where it counts.** Kit answers "is this structurally sound?" mechanically. The maintainer
  decides what only a person can: what the product promises, which concepts exist, how topics group.
- **Safe to adopt.** Existing problems are recorded as debt that may only go down. Nothing has to be rewritten at
  once, and the app keeps shipping.

What it costs: more, smaller files; a heading, a terms line and a claim for each new concept; and a maintainer who
ratifies them. It is tuned for agents writing the code. A small team of people writing it by hand may find it heavy.

## What it checks

| Rule | Holds |
|---|---|
| R1 zones and capabilities | **core** decides and performs no effect; **shell** renders and normalises input; **substrate** does I/O. Clock, randomness and host globals are used only in declared adapters, and every external package declares what it may do. No type escapes. |
| R2 dependencies | Readings use primitives and readings; adapters use only primitive data contracts; compositions may use all four layers. Across zones, imports point inward to core. No cycles. |
| R3 names and comments | Every placed module is a concept defined once in the terms file. Retired words stay out. Comments say why, cite nothing and carry no TODOs. |
| R4 proof | Every claim is proved by `oracle/<topic>/<anchor>.test.ts`, and every test names a claim in its topic. |

Each finding names the rule it serves and its fix. The full rules are in `spec/`; why they are that way is in
`docs/decisions.md`.

## Adding Kit to a TypeScript codebase

You need Node 22 and a `tsconfig.json` that covers your source. Kit reads compiler facts from it; nothing is built
through it.

1. **Get Kit.** Clone this repository beside your app and run `npm install` in it. In your app's `package.json`:

   ```json
   "kit": "node ${KIT:-../kit}/scripts/kit-check.mjs --root=. --config=kit/config.md --baseline=kit/debt/legacy.json"
   ```

2. **Write `kit/config.md`.** One YAML block declares your layout. Map each existing source folder to the zone it
   behaves like; it stays legacy until its code moves into place. List every external package and what it may do.

   ````markdown
   ```yaml
   app: my-app
   roots:
     src: src/
     spec: spec/
     oracle: oracle/
   legacy-zones:
     - { root: src/domain/, zone: core }
     - { root: src/ui/, zone: shell }
     - { root: src/server/, zone: substrate }
   terms: spec/terms.md
   claim-separator: "·"
   legacy-areas: []
   packages:
     - { name: "node:fs", capabilities: [filesystem] }
     - { name: "yaml", capabilities: [] }
   adapters: []
   ```
   ````

3. **Write `spec/terms.md`.** One line per word of your domain, `- **term** — meaning`. Start with the words your
   spec and code already use; each new module adds its own line later.

4. **Record today's debt.** Run the report and keep its legacy findings as the starting baseline:

   ```sh
   npm run --silent kit -- --report 2>/dev/null > kit-report.json
   node -e 'const r=JSON.parse(require("fs").readFileSync("kit-report.json"));const o={};for(const f of r.findings.filter(f=>f.category==="legacy-debt"))o[f.debtKey]={fix:f.fix,path:f.path};require("fs").writeFileSync("kit/debt/legacy.json",JSON.stringify(o,null,2)+"\n")'
   ```

   Checker limits are listed but never become debt. Placed violations never do either.

5. **Turn the spec into topics.** Each topic is one `spec/<topic>.md`, usually one thing a user does. A claim is one
   list item closed by its anchor: `- <text> · {#anchor}`. Move each claim's tests to
   `oracle/<topic>/<anchor>.test.ts`. Until a spec file is converted, list it under `legacy-areas`.

6. **Run it in CI.** `npm run kit` must exit 0 on every pull request. Nothing users see changes; adoption only
   records where the code stands.

## How development works afterwards

- **Start from the topic.** Read the topic for your task before any code, then open only the modules it names.
- **New code lands in place.** A new module goes to `src/<zone>/<layer>/<name>.ts`, one module per file, with a
  kebab-case name. It needs a `### <zone>/<layer>/<name>` heading in its topic and a terms line stating its role
  and zone.
- **Claims come with tests.** A new promise is a claim with an anchor in its topic, proved by
  `oracle/<topic>/<anchor>.test.ts`.
- **Legacy converges when touched, in two steps.** First move the code into place with no change in behaviour: the
  existing tests pass unchanged. Then make the change. Delete the old path in the same step that replaces it.
- **Debt only drains.** Remove the debt entries your change fixes. Never add one. New problems in placed code fail
  at once.
- **Kit's findings are the instructions.** Each says what to do. If a rule seems wrong, raise it with the
  maintainer; never bend the code to slip past a check, and never weaken a check to pass your own work.
- **The maintainer ratifies.** Topics, claims, headings and terms are the design decisions; agents propose them in
  pull requests and the maintainer okays them. Changes to Kit itself need the same okay.
- **Parallel work splits by topic.** Agents working on different topics rarely touch the same files.

## This repository

| Path | Holds |
|---|---|
| `spec/` | the rules: code structure, language, proof, convergence, the Kit itself, and its terms |
| `src/` | the checks, placed by the Kit's own model |
| `oracle/` | the Kit's tests |
| `fixture/` | small apps the tests read |
| `scripts/` | the runner: `kit-check.mjs`, its config reader and its snapshot cache |
| `self-config.md`, `self-debt/` | the Kit's config and debt for checking itself |
| `docs/decisions.md` | why the rules are the way they are |

```sh
npm install
npm test            # the Kit's tests
npm run typecheck   # strict typecheck of source, tests and fixtures
npm run check       # the Kit checks itself
```

Read `spec/` before creating or moving a module in Kit, and `docs/decisions.md` before changing a rule. The
maintainer approves each change to `spec/`, `src/` and `oracle/`.

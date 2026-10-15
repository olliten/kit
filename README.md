# Kit

Kit checks the structure of a TypeScript app against the app's own spec and tests. `kit check` fails when a
change puts code in the wrong place, gives it an effect its zone may not have, adds a module the terms file does not
define, or leaves a claim in the spec without a test.

## Why

- **Agents keep rules that are checked.** Instructions in a document are read once per session, and nothing
  enforces them. A check runs on every change. Kit expresses the architecture as checks.
- **Parallel agents need separate files.** Kit puts one module in each file, one claim's tests in each test file
  and each feature's spec in its own topic, so tasks on different topics rarely edit the same file.

The structure itself, a core with no effects and every effect behind an adapter, means domain logic is tested
without a browser, network or storage.

## Terms

- **Zone**: what code may do. `core` decides and has no effects. `shell` renders and turns input into data.
  `substrate` does I/O.
- **Layer**: a module's role in its zone. `primitives` (types, constants), `readings` (pure derivations),
  `adapters` (one external capability each), `compositions` (wiring).
- **Placed**: a file at `src/<zone>/<layer>/<name>.ts`. Every other source file is legacy.
- **Topic**: one spec file, `spec/<topic>.md`.
- **Claim**: a list item in a topic that ends with its anchor: `- <text> · {#<anchor>}`.
- **Debt**: a finding in legacy code, recorded in the app's baseline file.
- **Limit**: something Kit cannot verify, such as dynamic access to a global.

## What fails the check

| Finding | Fails |
|---|---|
| A violation in placed code | always |
| A finding in legacy code | only if it is not in the baseline |
| A limit | only if it is in placed code, or in a file placed code imports at runtime, directly or indirectly |

The rules, R1 to R4, are in `spec/code-structure.md`, `spec/language.md` and `spec/proof.md`. Every finding
states its fix. `docs/decisions.md` records why each rule exists.

## Adding Kit to an app

Requires Node 22 and a `tsconfig.json` that covers the app's source.

1. Clone this repository next to the app and run `npm install` in it. Add a script to the app's `package.json`:

   ```json
   "kit": "node ${KIT:-../kit}/scripts/kit-check.mjs --root=. --config=kit/config.md --baseline=kit/debt/legacy.json"
   ```

2. Create `kit/config.md` with one YAML block. `legacy-zones` maps each existing folder to the zone its code
   behaves like. `packages` lists every external import and the capabilities it grants. An undeclared package is a
   limit.

   ````markdown
   ```yaml
   app: my-app
   roots: { src: src/, spec: spec/, oracle: oracle/ }
   legacy-zones:
     - { root: src/domain/, zone: core }
     - { root: src/ui/, zone: shell }
     - { root: src/server/, zone: substrate }
   terms: spec/terms.md
   claim-separator: "·"
   legacy-areas: [spec/old-requirements.md]
   packages:
     - { name: "node:fs", capabilities: [filesystem] }
   adapters: []
   ```
   ````

3. Create `spec/terms.md`: one line per domain word, `- **<term>** — <meaning>`.

4. Write the current findings to the baseline:

   ```sh
   npm run --silent kit -- --report 2>/dev/null > kit-report.json
   node -e 'const r=JSON.parse(require("fs").readFileSync("kit-report.json"));const o={};for(const f of r.findings.filter(f=>f.category==="legacy-debt"))o[f.debtKey]={fix:f.fix,path:f.path};require("fs").writeFileSync("kit/debt/legacy.json",JSON.stringify(o,null,2)+"\n")'
   ```

5. Convert the spec to topics and claims. Move each claim's tests to `oracle/<topic>/<anchor>.test.ts`, or
   `<anchor>.<variant>.test.ts` when one claim has several test files. List spec files not yet converted under
   `legacy-areas`; Kit reads no claims from them.

6. Run `npm run kit` in CI. It must exit 0.

## Working in an app that uses Kit

1. Read the task's topic, then only the modules it names.
2. Put each new module in its own file at `src/<zone>/<layer>/<name>.ts`, with a kebab-case name.
3. Declare it in its topic with a heading `### <zone>/<layer>/<name>`, and in `spec/terms.md` with its role and
   zone:

   ```markdown
   - **running-total** — the sum of the steps so far.
     - Role: derived
     - Zone: core
     - From: []
   ```

   Roles map to layers: `fact` → primitives, `derived` → readings, `adapter` → adapters, `composition` →
   compositions.
4. Add each new promise as a claim in its topic, with a test at `oracle/<topic>/<anchor>.test.ts`.
5. To change legacy code, first move it into place without changing behaviour, so the existing tests pass
   unchanged. Then change it in a separate step. Delete the old file in the move.
6. Delete the baseline entries your change fixes. Never add entries.
7. Run `npm run kit`. If a finding's fix seems wrong, ask the maintainer. Do not change a check to pass.

The maintainer approves the topics, claims, headings and terms in each pull request.

## This repository

| Path | Contents |
|---|---|
| `spec/` | Kit's rules and terms |
| `src/` | the checks |
| `oracle/` | Kit's tests |
| `fixture/` | sample apps the tests read |
| `scripts/` | the `kit check` runner, config reader and cache |
| `self-config.md`, `self-debt/` | Kit's config and baseline for checking itself |
| `docs/decisions.md` | the reason for each rule |

```sh
npm install
npm test            # Kit's tests
npm run typecheck
npm run check       # Kit checks itself
```

Changes to `spec/`, `src/` and `oracle/` need the maintainer's approval.

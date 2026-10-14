# Kit

Structural checks for a TypeScript app: where code goes, what each zone may do, what names mean, and how each
claim in the spec is proved. The Kit is built with its own model and checks itself.

## Layout

| Path | Holds |
|---|---|
| `spec/` | the rules: code structure, language, proof, convergence, the Kit itself, and its terms |
| `src/` | the checks, placed by the Kit's own model |
| `oracle/` | the Kit's tests |
| `fixture/` | small apps the tests read |
| `scripts/` | the runner: `kit-check.mjs`, its config reader and its snapshot cache |
| `self-config.md`, `self-debt/` | the Kit's config and debt for checking itself |
| `docs/decisions.md` | why the rules are the way they are |

Read `spec/` before creating or moving a module. Read `docs/decisions.md` before changing a rule.

## Commands

```sh
npm install
npm test            # the Kit's oracle
npm run typecheck   # strict typecheck of source, tests and fixtures
npm run check       # the Kit checks itself
```

## Checking an app

An app keeps its own config and debt list, conventionally `kit/config.md` and `kit/debt/legacy.json`:

```sh
node <kit>/scripts/kit-check.mjs --root=<app> --config=<app>/kit/config.md --baseline=<app>/kit/debt/legacy.json
```

`--report` prints every finding as JSON instead of failing. The baseline is a JSON object keyed by debt key;
seed it from the report's legacy findings. After that, the check fails on any new debt, on any violation in placed
code and on any checker limit reachable from placed code.

## Changes

The maintainer approves each change to `spec/`, `src/` and `oracle/`. No change weakens a check to pass its own
work.

# kit — what the kit is, and the rules it keeps for itself

> The kit is an app built with its own model and checked by itself.

- **Portable.** It names no app concept. Everything app-specific is the app's spec and its config.
- **Small.** It stays under 10% of the code it governs, and every check names the rule it serves.
- **Product prose names no code.** Structural declarations may bind named types and selected domain fields.
  They do not duplicate type shapes or prescribe helper modules.
- **Self-hosted.** `kit check` runs on the kit itself. Its folders are `spec`, `oracle`, `src` and `fixture`; its
  own config is `self-config.md`.
- **The app's use of it** lives in the app: `kit/config`, `kit/debt/` and `kit/ledger/`.
- **Protected.** No agent weakens a check to pass its own work. Only the kit lane writes `spec`, `oracle` and `src`,
  with the maintainer's okay on each change.
- **Its public surface:** the config schema, the finding format, and four commands: `kit check` (fails on new
  debt), `kit ledger`, `kit partition` (test tiers for the runner), and `kit rename <from> <to>`.
- **Evidence.** The fixture is a small app in legacy shape. Replaying its recorded fixes reaches zero debt, and the
  ratchet never rises along the way.
- **Its own repository.** The kit is a separate package; config, debt and ledger stay with each app.

The Kit follows [[code-structure]], [[language]], [[proof]] and [[convergence]] itself.

## Contracts

### core/primitives/default-config

Supply the starting configuration while allowing each app to declare its layout. Uses {{default-config}}.

### core/primitives/file

Keep FileType, SnapshotFile and file-text support with their shared input owner. Uses {{file}}.

### core/primitives/snapshot

Assemble supplied evidence from its actual primitive owners; checks add interpretations rather than acquisition effects. Uses {{snapshot}}.

### substrate/adapters/filesystem

Keep real file acquisition behind its narrow operation contract. Uses {{filesystem}}.

### substrate/adapters/compiler

Keep real compiler access behind its narrow operation contract. Uses {{compiler}}.

### substrate/compositions/read-snapshot

Connect acquisition adapters to pure interpreters and return their supplied evidence together. Uses {{read-snapshot}}.

## Proof obligations

- a cache hit reuses extraction, reruns the checker and retains unresolved evidence. · {#cached-check-keeps-evidence}
- the fixture reads as its files, imports and headings. · {#read-snapshot-fixture}
- the real snapshot reader discovers every independently supplied case input. · {#readings-use-data}

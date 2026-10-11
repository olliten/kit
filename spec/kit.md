# kit — what the kit is, and the rules it keeps for itself

> The kit is an app built with its own model and checked by itself.

- **Portable.** It names no app concept. Everything app-specific is the app's spec and its config.
- **Small.** It stays under 10% of the code it governs, and every check names the rule it serves.
- **The spec names no code:** no functions, types, libraries or file paths. A module's identity is a name, not a
  path.
- **Self-hosted.** `kit check` runs on the kit itself. Its folders are `kit/spec`, `kit/oracle`, `kit/src` and
  `kit/fixture`.
- **The app's use of it** lives beside it: `kit/config`, `kit/debt/` and `kit/ledger/`. The app's own checks treat
  `kit/` as a separate app.
- **Protected.** No agent weakens a check to pass its own work. Only the kit lane writes `kit/spec`, `kit/oracle` and
  `kit/src`, with the owner's okay on each change.
- **Its public surface:** the config schema, the finding format, and four commands: `kit check` (fails on new
  debt), `kit ledger`, `kit partition` (test tiers for the runner), and `kit rename <from> <to>`.
- **Evidence.** The fixture is a small app in legacy shape. Replaying its recorded fixes reaches zero debt, and the
  ratchet never rises along the way.
- **Extraction.** When a second app adopts it, `kit/{spec,oracle,src,fixture}` becomes its own package; config, debt
  and ledger stay with the app.

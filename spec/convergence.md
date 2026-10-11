# convergence — how a codebase gets to the model, and stays there

> If agents only ever make the kit's checks pass, the codebase should end in the model and only there. This is a goal
> shown by evidence (the fixture), not a proof.

- **Opt-in by path.** An artifact is held to R1–R4 once it sits at `<zone>/<kind>/`. The kit installs into any
  codebase with a green gate.
- **The whole tree converges.** Every source file lives in a zone, or in an exception the config declares. A legacy
  file counts as debt, so legacy only shrinks, and no new source file may appear outside a zone.
- **The ledger.** One derived page shows, per artifact: its state (legacy → placed → converged), its open debt per
  check, its test tiers and its findings. It is computed from the snapshot and the debt lists, never by hand.
- **The ratchet.** A change never raises total open debt and never moves an artifact back a state. Its PR reports the
  delta.
- **Gradient.** Every finding names its fix and its rule. A rule a check can only approximate is marked review-held.
- **Topics are a lens.** Spec topic files are narrative and group headings freely; each artifact has exactly one
  heading. A generated topic index shows, per topic, its artifacts → code files → tests.
- **Debt only drains.** Each check keeps one keyed debt list. An entry names what drains it and never comes back.

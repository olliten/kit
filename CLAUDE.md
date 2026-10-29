# Working on Kit

Kit is built in its own structure; its config is `self-config.md`. Work in the two phases of the README's
"Working in two phases":

1. **Plan.** Edit only the shared files: the topic's claims in `spec/`, the module lines in `spec/terms.md`,
   contract types in `primitives`, and adapter registrations in `self-config.md`.
   When a claim names a module others already name, a claim needing a different part of it gets a new module.
2. **Work.** Write one claim's test file or one term's module per agent, at the paths the plan names.

Reading a module shows the claims it keeps; `npm run refs -- <module>` lists them too.

Before every push, `npm run typecheck` and `npm test` pass, `npm run runs -- --stale` records which functions each changed test runs (`npm run runs` records every test),
and `npm run check` passes. The check carries no legacy
baseline, so any finding is yours to fix.

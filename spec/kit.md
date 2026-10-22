# Kit

The Kit is built in its own structure and checks itself. It names no app concept: an app's layout lives in
its config, and its debt in its own baseline.

## Reading an app

- A root declaration the checks do not support is an error, never an ignored root; configuration
  accepts only the supported root fields and shapes. `roots.src` accepts one code-root path or a set of
  paths, checked together in one snapshot and graph; extraction, authority, structural checks, references
  and debt accounting cover every selected code root. The spec and proof roots remain single paths. · {#declared-roots-are-checked}
  - Proof: {{fixture-snapshot}}, {{source-fixture}}

- Test discovery includes the configured proof root and only explicitly configured
  `legacy-test-roots`, with no application directory names built in. Each is a relative directory
  without patterns or dot segments; invalid declarations fail instead of dropping proofs. Legacy
  discovery grants no placement or capability permission. · {#proof-discovery-is-configured}

- An app may opt into directory roles with `layout: { legacy: [...] }`. Source and shared proof code
  belong in its governed code roots, tests in its proof root, and Markdown in its specification root
  rather than code roots. The proof root is one governed code root; the specification root is separate.
  Other Markdown and non-code assets are not specifications merely by existing in the repository.
  Exact relative legacy files or directories retain their misplaced files as location debt; new location
  debt fails the ratchet. Missing or malformed legacy locations fail configuration. Legacy locations
  grant no module placement, capability or executable-entrypoint permission. Without a layout declaration,
  existing configuration keeps its behavior. · {#directory-roles-are-configured}
  - Implementation: {{layout-check}}, {{placement-of}}, {{read-snapshot}}
  - Proof: {{source-fixture}}

- {{read-snapshot}} reads the fixture as its files, imports, claims and terms through {{filesystem}} and
  {{compiler}}, and the check finds exactly the fixture's seeded findings ({{snapshot}}, {{file}}). · {#read-snapshot-fixture}
  - Proof: {{binding-findings}}
- The real snapshot reader discovers every case input it is given, and readings over that data run without
  changing it ({{read-snapshot}}). · {#readings-use-data}
  - Proof: {{case-inventory}}
- A cache hit reuses extraction and reruns the check; a corrupt cache is rebuilt, and a source change during
  extraction or checking rejects the result. `kit check --fresh-compare` also extracts afresh and fails when
  the cached snapshot or its findings differ. Snapshots too large for JSON remain reusable in their original
  checkout. A storage failure is reported and leaves the fresh check authoritative. · {#cached-check-keeps-evidence}
- A cached snapshot is reused only while every read its extraction made through {{filesystem}} and
  {{compiler}} returns the same: each file's bytes, each directory listing and each probe that found nothing.
  A change nothing read misses no entry, and worktrees of one repository share one cache. · {#cache-keys-on-what-was-read}
- A path the config ignores is never listed or read by {{read-snapshot}}, and an import into it is an error,
  never a missing edge. · {#ignored-paths-are-unread}
- `kit refs` lists the claims that name a module, each with its topic and tests; as a read hook it adds that
  list to what an agent sees when it opens the module, and adds nothing for any other file. · {#refs-list-a-modules-claims}
- `kit consumers <app>…` checks each app checkout against this Kit, with the app's own config and baseline, and
  lists per app the findings that would fail it, grouped by check, beside the Kit commit the app pins; an app
  that fails does not fail the run. · {#consumers-show-each-apps-work}
- Paths given to `kit check` resolve against the directory it runs in; with none, the Kit checks itself. · {#paths-from-the-caller}

## Checking itself

- Source fixtures own separate temporary directories, write supplied relative paths only inside their
  directory with the declared compiler settings and roots, and dispose the directory on return or
  failure. · {#source-fixtures-own-their-files}
  - Implementation: {{source-fixture}}, {{temporary-project}}

- Kit's production source is placed and its imports obey the dependency rules; its claims, modules and
  tests bind with no finding, its placed modules bind to terms without supporting-word terms, its terms
  are defined once, its names and prose use no retired word, and its comments cite nothing and carry no
  debt. These checks use one snapshot of the actual configured repository. · {#kit-checks-itself}
  - Implementation: {{comment-check}}, {{dependency-check}}, {{name-check}}, {{placement-of}}, {{proof-reach}}, {{read-snapshot}}, {{term-model}}
  - Proof: {{binding-findings}}

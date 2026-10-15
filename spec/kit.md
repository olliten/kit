# Kit

The Kit is built in its own structure and checks itself. It names no app concept: an app's layout lives in
its config, and its debt in its own baseline.

## Reading an app

- {{read-snapshot}} reads the fixture as its files, imports, claims and terms through {{filesystem}} and
  {{compiler}}, and the check finds exactly the fixture's seeded findings ({{snapshot}}, {{file}}). · {#read-snapshot-fixture}
- The real snapshot reader discovers every case input it is given, and readings over that data run without
  changing it ({{read-snapshot}}). · {#readings-use-data}
- A cache hit reuses extraction and reruns the check; a corrupt cache is rebuilt, and a source change during
  extraction or checking rejects the result. · {#cached-check-keeps-evidence}
- `kit refs` lists the claims that name a module, each with its topic and tests; as a read hook it adds that
  list to what an agent sees when it opens the module, and adds nothing for any other file. · {#refs-list-a-modules-claims}
- Paths given to `kit check` resolve against the directory it runs in; with none, the Kit checks itself. · {#paths-from-the-caller}

## Checking itself

- Every Kit source file is placed, its imports obey the dependency rules, and its claims, modules and tests
  bind with no finding. · {#kit-checks-itself}
- The Kit's terms are each defined once, and its names and prose use no retired word. · {#kit-terms-are-defined-once}
- The Kit's placed modules bind to their terms without supporting-word terms. · {#kit-modules-bind-to-terms}
- The Kit's comments cite nothing and carry no debt. · {#kit-comments-cite-nothing}

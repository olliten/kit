# Browser SDK checkpoint — 4 November 2026

Kit #89 owns pure mapping; #90 scopes the symlink CLI fixture to immutable example inputs.
Draft #91 owns only native browser runtime identity and cleanup. Source and oracle commits remain
independent. Types and three real native cases pass; exact full verification after #90 remains pending.
No capture, writer, application adoption or execution-rule activation is included.

Before adoption, the SDK needs an exact public-subpath package-contract boundary. The current global
package matcher uses the root package name; declaring all of `kit` pure or effectful, or using a namespace
alias, would not establish the intended boundary. A future bounded change may support real owned public
subpaths while preserving the existing root fallback, with independent positive and negative proofs.
That authority-model change is outside #91.

The approved map artifact is data-only version 1: `scripts: [{scriptHash, base, map}]`. Its SDK consumer
must uniquely match the served bytes and validate raw mappings/original bytes against actual sources and
Kit's inventory. Capture and writer slices must retain all lifecycle guards and fail closed for unknown
or unsupported contexts. The application retains canonical bundle/map preparation.

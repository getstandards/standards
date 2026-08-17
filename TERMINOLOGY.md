# Terminology

Canonical words used across Standards code and documentation.

## Terms

- **applies_to** — The `include`/`exclude` glob filter that scopes a rule to a subset of repository files.
- **configuration** — The validated `.standards.yml` document (`version`, `name`, `description`, `extends`, `rules`).
- **configuration graph** — The transitive graph of configuration files reached through `extends`, walked during resolution.
- **diagnostic** — A structured, human-actionable error report with category, source, field, problem, and next action.
- **entry file** — The `.standards.yml` at the repository root that starts resolution.
- **extends** — An ordered list of other configuration sources loaded before the current file's own rules.
- **extension cycle** — A resolution failure that occurs when a source extends itself, directly or indirectly.
- **glob** — A repository-relative, OS-independent path pattern. Version 1 supports `*`, `?`, `**`, `[abc]`, and `{a,b}`.
- **guidance** — A rule field with non-normative remediation or an alternative approach.
- **level** — The requirement level of a rule: `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, or `MAY` (RFC 2119).
- **lockfile** — The `.standards.lock` document that pins every mutable revision to an exact commit for reproducibility.
- **mutable revision** — A `tag` or `branch` revision, as opposed to an immutable `commit`. Mutable revisions require a lock entry.
- **rationale** — A rule field that states why the rule exists and which risk it addresses.
- **references** — A rule field with supporting URLs or repository-relative paths.
- **repository root** — The canonicalized root directory where `.standards.yml` and `.standards.lock` must live.
- **resolution** — The process that loads the entry file, walks the configuration graph, substitutes locked commits, merges rules, and rejects duplicates and cycles.
- **review** — The act of an agent that evaluates a pull request's changes against the resolved rule set.
- **revision** — The Git state to load for a source: exactly one of `commit`, `tag`, or `branch`.
- **rule** — One testable statement of required, prohibited, or recommended behavior (`id`, `level`, `description`, `rationale`, `applies_to`, `guidance`, `references`).
- **rule set** — The collection of rules that a configuration declares, or the flattened ordered list after resolution.
- **schema** — The normative JSON Schema documents in `schemas/v1/`.
- **source** — One `extends` entry: a local source (`path`) or a Git source (`repository`, `revision`, `path`).
- **source lock** — One resolved lockfile entry: `repository`, `revision`, and the resolved `commit`.
- **version** — The integer discriminator for document syntax. The configuration format and the lock format evolve independently.

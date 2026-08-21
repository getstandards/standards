# Terminology

Canonical words used across Standards code and documentation.

## Terms

- **annotation** — One check run mark on a confirmed finding's `path` and `lines`: `failure` for `MUST`/`MUST NOT`, `warning` otherwise.
- **applies_to** — The `include`/`exclude` glob filter that scopes a rule to a subset of repository files.
- **check run** — The GitHub check named `Standards` that one action run creates for the head commit and completes with the conclusion, the report, and the annotations.
- **configuration** — The validated `.standards.yml` document (`version`, `name`, `description`, `extends`, `rules`).
- **configuration graph** — The transitive graph of configuration files reached through `extends`, walked during resolution.
- **diagnostic** — A structured, human-actionable error report with category, source, field, problem, and next action.
- **entry file** — The `.standards.yml` at the repository root that starts resolution.
- **extends** — An ordered list of other configuration sources loaded before the current file's own rules.
- **extension cycle** — A resolution failure that occurs when a source extends itself, directly or indirectly.
- **finding** — One reported rule violation: `rule`, `path`, `lines`, `evidence`, `reason`.
- **full review** — A review whose base revision is the empty tree, so the change contains every tracked file of the head revision as an added file.
- **glob** — A repository-relative, OS-independent path pattern. Version 1 supports `*`, `?`, `**`, `[abc]`, and `{a,b}`.
- **guidance** — A rule field with non-normative remediation or an alternative approach.
- **level** — The requirement level of a rule: `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, or `MAY` (RFC 2119).
- **lock file** — The `.standards.lock` document that pins every mutable revision to an exact commit for reproducibility.
- **mutable revision** — A `tag` or `branch` revision, as opposed to an immutable `commit`. Mutable revisions require a lock entry.
- **rationale** — A rule field that states why the rule exists and which risk it addresses.
- **references** — A rule field with supporting URLs or repository-relative paths.
- **repository root** — The canonicalized root directory where `.standards.yml` and `.standards.lock` must live.
- **resolution** — The process that loads the entry file, walks the configuration graph, substitutes locked commits, merges rules, and rejects duplicates and cycles.
- **review** — The act of an agent that evaluates a change — the hunks between a base and a head revision — against the resolved rule set.
- **revision** — The Git state to load for a source: exactly one of `commit`, `tag`, or `branch`.
- **rule** — One testable statement of required, prohibited, or recommended behavior (`id`, `level`, `description`, `rationale`, `applies_to`, `guidance`, `references`).
- **rule set** — The collection of rules that a configuration declares, or the flattened ordered list after resolution.
- **rule verdict** — The evaluation agent's decision for one rule and file pair: `compliant` or `violated`, with one finding per violation.
- **schema** — The normative JSON Schema documents in `schemas/v1/`.
- **source** — One `extends` entry: a local source (`path`) or a Git source (`repository`, `revision`, `path`).
- **source lock** — One resolved lock file entry: `repository`, `revision`, and the resolved `commit`.
- **summary comment** — The one pull request comment that carries the report, found by the `<!-- standards:report:v1 -->` marker on its first line.
- **target** — A repository-relative path, file or directory, passed to `standards review` to limit the review to the changed files it matches.
- **version** — The integer discriminator for document syntax. The configuration format and the lock format evolve independently.

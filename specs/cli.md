# Standards CLI

Defines the command-line interface for Standards.

## Purpose

The Standards CLI lets users create a Standards configuration, validate,
resolve, list, and test its rules, update its lock file, store model provider
credentials, and review changes from a terminal or automation environment.

The CLI implementation MUST be defined in `src/cli`.

## Commands

The executable name is `standards`. It provides these commands:

| Command | Purpose | Current behavior |
| --- | --- | --- |
| `standards init` | Create an initial Standards configuration. | Planned. Currently no operation. |
| `standards validate` | Validate the configuration and resolve its complete rule set. | Implemented. |
| `standards lock` | Resolve mutable Git sources and update the lock file. | Implemented. `--check` is planned. |
| `standards rules` | List the resolved rule set with each rule's origin. | Planned. |
| `standards review` | Review changes against the resolved rule set. | Planned. Currently no operation. The pipeline is specified in [Standards review](./review.md). |
| `standards test` | Run rule tests against the resolved rule set. | Planned. Specified in [Standards rule tests](./testing.md). |
| `standards cache clean` | Remove every entry in the source cache. | Planned. |
| `standards cache prune` | Remove source cache entries that the configuration does not reference. | Planned. |
| `standards login <provider>` | Store a credential for a model provider. | Planned. |
| `standards logout <provider>` | Remove the stored credential for a model provider. | Planned. |

`init` and `review` reserve their command names: until they are implemented,
they MUST exit with status `0` without output or other effects.

## General behavior

Running `standards` without a command or with `--help` or `-h` MUST print help
to standard output and exit with status `0`. Running `standards --version`
MUST print the application version to standard output and exit with status
`0`.

An unknown command MUST print a diagnostic and the help text to standard error.
It MUST exit with status `1`.

A command accepts only the positional arguments and options listed for it in
this specification. No command other than `login` and `logout` accepts a
positional argument. Supplying an argument or option that a command does not
accept MUST print a diagnostic to standard error and exit with the command's
error status defined below.

### Exit statuses

`review`, `test`, and `lock --check` are checking commands: their result can
be negative even though the command ran completely. Automation must separate
a negative result from a broken run, so a checking command MUST use three
statuses:

| Status | Meaning |
| --- | --- |
| `0` | The command ran completely and the result is positive: a compliant review, passing rule tests, an up-to-date lock file. |
| `1` | The command ran completely and the result is negative: a non-compliant review, a failing rule test, a stale lock entry. |
| `2` | The command could not run or complete: invalid arguments, invalid configuration, a missing credential, or a provider failure. |

Every other command exits with status `0` on success and status `1` on any
failure.

## Options

These options control the source cache defined in
[Standards source cache](./cache.md):

| Option | Meaning | Accepted by |
| --- | --- | --- |
| `--cache-dir <path>` | Use `<path>` as the cache directory instead of the default. | `validate`, `lock`, `rules`, `review`, `test`, `cache clean`, `cache prune` |
| `--no-cache` | Do not read from or write to the persistent cache for this invocation. | `validate`, `lock`, `rules`, `review`, `test` |

`--cache-dir` MUST take priority over the `STANDARDS_CACHE_DIR` environment
variable and over the `cache_dir` field of the settings file defined in
[Standards settings](./settings.md). `--no-cache` MUST have the same effect
as the `STANDARDS_NO_CACHE` environment variable. Cache location, disabling,
and precedence are specified in [Standards source cache](./cache.md).

These options select the models defined in [Standards review](./review.md):

| Option | Meaning | Accepted by |
| --- | --- | --- |
| `--model <provider>/<model>` | Run both agent steps on this provider and model. | `review`, `test` |
| `--evaluation-model <provider>/<model>` | Run the evaluation step on this provider and model. | `review`, `test` |
| `--verification-model <provider>/<model>` | Run the verification step on this provider and model. | `review`, `test` |

A per-step option MUST take priority over `--model` for its step. Every model
option MUST take priority over the environment variables `STANDARDS_MODEL`,
`STANDARDS_EVALUATION_MODEL`, and `STANDARDS_VERIFICATION_MODEL`, and over
the model fields of the settings file defined in
[Standards settings](./settings.md). Model reference validation, the
complete selection precedence, and the default models are specified in
[Standards review](./review.md).

These options control command input and output:

| Option | Meaning | Accepted by |
| --- | --- | --- |
| `--base <revision>` | Review the change since `<revision>` instead of the default base. | `review` |
| `--format <format>` | Output format: `text` (default) or `json`. | `review`, `rules` |

With `--format json`, the command MUST write exactly one JSON document to
standard output and nothing else. Progress and diagnostics stay on standard
error.

Progress that a command reports while it resolves and imports Git sources MUST
be written to standard error, as specified in
[Standards source cache](./cache.md). It MUST NOT mix with the machine-readable
summary that a command writes to standard output.

## `init`

`standards init` creates the entry file for a repository that has none.

The command MUST create `.standards.yml` in the current working directory.
The created file MUST be a valid version 1 configuration with an empty rule
set, and SHOULD contain commented examples for `extends` and one rule. On
success, the command MUST report the created path and exit with status `0`.

When `.standards.yml` already exists, the command MUST print a diagnostic and
exit with status `1`. It MUST NOT modify the existing file. The command MUST
NOT create a lock file; `standards lock` creates one when the configuration
needs it.

## `validate`

`standards validate` MUST load `.standards.yml` from the current working
directory and resolve its complete configuration graph as defined in
[Standards configuration format](./configuration.md).

On success, the command MUST print the canonical repository path, entry-file
name, lock-file state, number of resolved rules, and rule counts grouped by
requirement level. It MUST exit with status `0`.

If configuration loading, validation, or resolution fails, the command MUST
print an invalid-configuration heading and the diagnostic to standard error.
It MUST exit with status `1`.

The diagnostic MUST include:

- The failure category.
- The canonical repository path when it can be resolved.
- The configuration or lock-file source when known.
- The YAML field path when known.
- The original problem without duplicated source and field prefixes.
- A relevant next action.

The command MUST NOT modify the configuration, the lock file, or any other
repository file.

## `lock`

`standards lock` MUST load `.standards.yml` from the current working directory
and traverse its complete configuration graph. It MUST resolve each tag through
its exact `refs/tags/` reference and each branch through its exact `refs/heads/`
reference. It MUST NOT fall back to another reference type with the same name.

For an annotated tag, the command MUST record the commit to which the tag
ultimately points. A configuration source pinned directly to a commit MUST NOT
produce a lock entry, but mutable sources discovered through that configuration
MUST produce entries in the root lock file.

The command MUST write `.standards.lock` at the canonical repository root.
It MUST include exactly one entry for each distinct mutable source. Entries MUST
be sorted by repository, revision type, and revision value. A configuration
without mutable sources MUST produce a valid lock file with an empty `sources`
array.

The command MUST replace the lock file through a temporary sibling file. It
MUST NOT rewrite the lock file when its generated content is unchanged.

On success, the command MUST report whether the lock file changed, the
repository and lock-file paths, and counts for all mutable sources, branches,
and tags. It MUST exit with status `0`.

If configuration traversal, Git resolution, or file writing fails, the command
MUST print the problem and a relevant next action to standard error. It MUST
exit with status `1` and MUST NOT replace the existing lock file with partial
content.

### `lock --check`

`standards lock --check` answers one question for automation: is the lock
file still what `standards lock` would write today? The command MUST perform
the same traversal and reference resolution as `lock`, but MUST NOT write or
modify any file.

- When every resolved commit matches its lock entry, and no entry is missing
  or unused, the command MUST report the up-to-date state and exit with
  status `0`.
- Otherwise the command MUST report each difference — the repository, the
  revision, the locked commit, and the newly resolved commit, or the missing
  or unused entry — and exit with status `1`.
- When traversal or resolution fails, the command MUST print the problem and
  exit with status `2`.

A stale result is information, not an update. A user adopts the change by
running `standards lock` and committing the diff.

## `rules`

`standards rules` lists the resolved rule set, so that a user can audit which
rules apply to a repository and where each one came from.

The command MUST load `.standards.yml` from the current working directory and
resolve its complete configuration graph, exactly as `validate` does. It MUST
print every resolved rule in resolution order with:

- The rule `id` and `level`.
- The rule's source: the repository-relative path for a local source, or the
  repository, revision, resolved commit, and path for a Git source.

With `--format json`, the command MUST print the resolved rules as one JSON
document, each rule with its complete fields and its source.

The command exits with status `0` on success and status `1` when resolution
fails, with the same diagnostics as `validate`. It MUST NOT modify the
configuration, the lock file, or any other repository file.

## `review`

`standards review` runs the review pipeline defined in
[Standards review](./review.md) for the repository in the current working
directory.

The head revision is the checkout's `HEAD`. The base revision resolves in
this priority order:

1. The `--base <revision>` option, accepting any revision that Git can
   resolve.
2. The merge base of `HEAD` and the remote default branch.

When no `--base` is given and the merge base cannot be resolved, the command
MUST fail with a diagnostic that asks for `--base` and exit with status `2`.

The command MUST write the report to standard output: the text rendering by
default, or the machine-readable report with `--format json`, as defined in
[Standards review](./review.md). Progress MUST go to standard error.

As a checking command, `review` MUST use the three exit statuses: `0` for a
compliant conclusion, `1` for a non-compliant conclusion, and `2` when the
review could not run or complete. A conclusion MUST NOT be reported from an
incomplete review.

## `test`

`standards test` runs rule tests, as specified in
[Standards rule tests](./testing.md). As a checking command, it MUST use the
three exit statuses: `0` when every selected test passes, `1` when at least
one test fails, and `2` when the tests could not run or complete.

## `cache`

`standards cache` manages the persistent source cache defined in
[Standards source cache](./cache.md). It requires a subcommand. Running
`standards cache` without a subcommand MUST print a diagnostic and the help text
to standard error and exit with status `1`.

`standards cache clean` MUST remove all buckets under the resolved cache
directory. It MUST report the removed location and exit with status `0`. If the
cache directory does not exist, it MUST report that state and exit with status
`0`.

`standards cache prune` MUST load `.standards.yml` and, when present, its lock
file from the current working directory, compute the commit object IDs that
the resolved configuration graph references, and remove every source cache
entry whose commit is not in that set. It MUST report the number of removed
entries and exit with status `0`.

A `cache` subcommand MUST NOT modify the configuration, the lock file, or any
other repository file.

If cache resolution, traversal, or removal fails, the command MUST print the
problem and a relevant next action to standard error. It MUST exit with status
`1`.

## `login`

`standards login <provider>` stores a credential for one model provider, as
specified in [Standards provider credentials](./credentials.md). For a
provider with subscription support, it runs the provider's OAuth flow. For
other providers, it runs the interactive authentication method that the
provider SDK defines. This method can request an API key or provider values
such as a project, location, or profile. A secret prompt does not echo its
value.

On success, the command MUST report the provider and the credential kind and
exit with status `0`. It MUST NOT print the stored secret.

Running `standards login` without a provider, or with an unknown provider,
MUST print a diagnostic that lists the known providers to standard error and
exit with status `1`.

## `logout`

`standards logout <provider>` MUST remove the stored credential for that
provider and report the removal. When no credential is stored for that
provider, it MUST report that state. Both cases exit with status `0`.

A `login` or `logout` command MUST NOT modify the configuration, the lock
file, or any other repository file.

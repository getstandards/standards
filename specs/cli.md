# Standards CLI

Defines the command-line interface for Standards.

## Purpose

The Standards CLI lets users create a Standards configuration, validate,
resolve, list, and test its rules, manage model provider credentials, list
the usable model references, and review changes from a terminal or automation
environment.

The CLI implementation MUST be defined in `src/cli`.

## Commands

The executable name is `standards`. It provides these commands:

| Command | Purpose | Current behavior |
| --- | --- | --- |
| `standards init` | Create an initial Standards configuration. | Implemented. |
| `standards validate` | Validate the configuration and resolve its complete rule set. | Implemented. |
| `standards rules` | List the resolved rule set with each rule's origin. | Planned. |
| `standards review` | Review changes against the resolved rule set. | Implemented. The pipeline is specified in [Standards review](./review.md). |
| `standards test` | Run rule tests against the resolved rule set. | Planned. Specified in [Standards rule tests](./testing.md). |
| `standards cache` | Manage the source cache. Groups the `clean` and `prune` subcommands. | Planned. |
| `standards auth` | Manage model provider credentials. Groups the `login`, `logout`, and `status` subcommands. | Implemented. |
| `standards models [provider]` | List the model references that the configured providers make usable. | Implemented. |

`init` reserves its command name.

## General behavior

Running `standards` without a command or with `--help` or `-h` MUST print help
to standard output and exit with status `0`. Root help MUST open with a banner
that shows the Standards logo and the application version. It MUST list
`cache` and `auth` as single commands. It MUST NOT list their subcommands;
`standards cache --help` and `standards auth --help` print them. Running
`standards --version` MUST print
the application version to standard output and exit with status `0`. The
banner and the version are the only output that carries the logo; every other
command writes plain text, so machine-readable output stays clean.

An unknown command MUST print a diagnostic and the help text to standard error.
It MUST exit with status `1`.

A command accepts only the positional arguments and options listed for it in
this specification. No command other than `cache`, `auth`, `models`, and
`review` accepts a positional argument. Supplying an argument or option that
a command does not accept MUST print a diagnostic to standard error and exit
with the command's error status defined below.

### Exit statuses

`review`, `test`, and `auth status` are checking commands: their result can
be negative even though the command ran completely. Automation must separate
a negative result from a broken run, so a checking command MUST use three
statuses:

| Status | Meaning |
| --- | --- |
| `0` | The command ran completely and the result is positive: a compliant review, passing rule tests, at least one usable credential. |
| `1` | The command ran completely and the result is negative: a non-compliant review, a failing rule test, no usable credential. |
| `2` | The command could not run or complete: invalid arguments, invalid configuration, a missing credential, or a provider failure. |

Every other command exits with status `0` on success and status `1` on any
failure.

The user can end any interactive prompt with Ctrl+C. The command MUST then
stop at once, MUST NOT print a diagnostic, and MUST exit with status `0`.

## Options

These options control the source cache defined in
[Standards source cache](./cache.md):

| Option | Meaning | Accepted by |
| --- | --- | --- |
| `--cache-dir <path>` | Use `<path>` as the cache directory instead of the default. | `validate`, `rules`, `review`, `test`, `cache clean`, `cache prune` |
| `--no-cache` | Do not read from or write to the persistent cache for this invocation. | `validate`, `rules`, `review`, `test` |

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
| `--all` | Run a full review: review every tracked file of the head revision. For `models`, list every known provider and every model id. | `review`, `models` |
| `--format <format>` | Output format: `text` (default) or `json`. | `review`, `rules` |
| `--verbose` | Print detailed review progress to standard error. | `review` |

With `--format json`, the command MUST write exactly one JSON document to
standard output and nothing else. Progress and diagnostics stay on standard
error.

Progress that a command reports while it resolves and imports Git sources MUST
be written to standard error, as specified in
[Standards source cache](./cache.md). It MUST NOT mix with the machine-readable
summary that a command writes to standard output.

## `init`

`standards init` creates the entry file for a repository that has none through
an interactive dialogue.

When standard input and standard output are terminals, the command MUST run an
interactive dialogue that:

1. Asks whether the knowledge source is local or Git.
2. Asks for the local bundle root, or the Git repository, branch, and optional
   bundle path.
3. Scans the source and shows the folders that contain markdown documents with
   their document counts. It MUST NOT propose semantic folder names.
4. Lets the user select one or more folders, or enter folder paths manually
   when the source cannot be scanned.
5. Asks for the `MUST` or `SHOULD` level of each selected folder.
6. Lets the user add document exclusions for a folder.
7. Lets the user set a target repository `applies_to` filter for a folder.
8. Asks for an optional `id_prefix`.
9. Lets the user add another knowledge source.
10. Shows the complete `.standards.yml` preview and asks for confirmation
    before it writes the file.

The command MUST NOT define a folder layout for the bundle: the user selects
the folders and levels that apply.

On success, the command MUST write `.standards.yml` in the current working
directory, tell the user to run `standards validate`, and exit with status
`0`. Cancellation MUST leave the repository unchanged.

Without a terminal, the command MUST NOT write an empty or assumed
configuration. It MUST report that interactive input is required, leave the
repository unchanged, and exit with status `1`.

When `.standards.yml` already exists, the command MUST print a diagnostic and
exit with status `1`. It MUST NOT modify the existing file.

## `validate`

`standards validate` MUST load `.standards.yml` from the current working
directory and resolve its complete configuration graph as defined in
[Standards configuration format](./configuration.md).

On success, the command MUST print the canonical repository path and the
entry-file name. It MUST list each knowledge source with its mapped folders and
their levels, and each discovered rule with its derived id and level, so the
user can confirm exactly which documents became rules. It MUST print the
resolved commit of each Git source, the warnings for skipped knowledge
documents, the number of resolved rules, and the rule counts grouped by
requirement level. It MUST exit with status `0`.

If configuration loading, validation, or resolution fails, the command MUST
print an invalid-configuration heading and the diagnostic to standard error.
It MUST exit with status `1`.

The diagnostic MUST include:

- The failure category.
- The canonical repository path when it can be resolved.
- The configuration source when known.
- The YAML field path when known.
- The original problem without duplicated source and field prefixes.
- A relevant next action.

The command MUST NOT modify the configuration or any other repository file.

## `rules`

`standards rules` lists the resolved rule set, so that a user can audit which
rules apply to a repository and where each one came from.

The command MUST load `.standards.yml` from the current working directory and
resolve its complete configuration graph, exactly as `validate` does. It MUST
print every resolved rule in resolution order with:

- The rule `id` and `level`.
- The rule's source: the document path for a local source, or the repository,
  `branch`, resolved commit, and document path for a Git source.

With `--format json`, the command MUST print the resolved rules as one JSON
document, each rule with its complete fields and its source.

The command exits with status `0` on success and status `1` when resolution
fails, with the same diagnostics as `validate`. It MUST NOT modify the
configuration or any other repository file.

## `review`

`standards review` runs the review pipeline defined in
[Standards review](./review.md) for the repository in the current working
directory.

Running `standards review --help` or `standards review -h` MUST print the
review help text, which lists the review options and the current default
models, to standard output and exit with status `0`.

The head revision is the checkout's `HEAD`. The base revision resolves in
this priority order:

1. The `--all` option, which selects the empty tree as the base revision.
2. The `--base <revision>` option, accepting any revision that Git can
   resolve.
3. The merge base of `HEAD` and the remote default branch.

When neither `--all` nor `--base` is given and the merge base cannot be
resolved, the command MUST fail with a diagnostic that asks for `--base` or
`--all` and exit with status `2`.

### Targets

`standards review [target...]` limits the review to part of the change. A
target is a repository-relative path to a file or a directory.

- A file target selects the changed file at that path.
- A directory target selects every changed file under that path.
- Without targets, the review selects every changed file.

Targets filter the changed files. They do not change the base or head
revision, so they combine with `--base` and with `--all`.
`standards review --all <dir>` audits the tracked files under `<dir>`.

A target MUST exist in the head revision, or match a deleted file's base
path. For an invalid target, the command MUST print a diagnostic and exit
with status `2`. A valid target that matches no changed file is not an
error: it can produce an empty selection, which ends the review with a
compliant conclusion and zero model tokens, as defined in
[Standards review](./review.md).

### `review --all`

`standards review --all` runs a full review, as defined in
[Standards review](./review.md): the base revision is the empty tree, so
the change contains every tracked file of the head revision as an added
file. The pipeline, the report, and the exit statuses are unchanged.

`--all` and `--base` select the same input, so an invocation that gives
both MUST fail with a diagnostic and exit with status `2`.

A full review reads the whole repository through the selected models and
costs tokens in proportion to the repository size. The command MUST report
the number of selected files and evaluation tasks to standard error before
the evaluation step starts.

The command MUST write the report to standard output: the text rendering by
default, or the machine-readable report with `--format json`, as defined in
[Standards review](./review.md). Progress MUST go to standard error.

On an interactive terminal, the text report uses a small semantic color and
glyph vocabulary: a green check for a compliant review, a red cross for a
non-compliant one, red marks for `MUST` findings, yellow warnings for `SHOULD`
findings, dim labels, and cyan counts. The terminal rendering shows the same
information as the plain text report and changes neither the report data nor
the conclusion. When standard output is not a terminal, or the report is
captured, the command writes the plain text rendering without color codes or
glyphs, so redirects and automation stay clean.

On an interactive terminal, the command also shows a loading status on
standard error while the evaluation and verification steps run: a spinner
with the count of finished invocations of the running step. The status tells
the user that the review is working. The command erases the status line
before it writes the report or a diagnostic. Without an interactive terminal,
no loading status appears and progress stays plain text lines.

As a checking command, `review` MUST use the three exit statuses: `0` for a
compliant conclusion, `1` for a non-compliant conclusion, and `2` when the
review could not run or complete. A conclusion MUST NOT be reported from an
incomplete review.

### `review --verbose`

`standards review --verbose` prints detailed progress to standard error while
the review runs. The option is disabled by default. Without it, the review
prints only the report and the progress that this specification requires.

The verbose output MUST include the items that the review reaches:

- The base revision, the head revision, and the targets.
- The changed files that the targets select, and the rules that selection
  assigns to each file.
- The evaluation tasks that planning packs, and the rules in each task.
- The progress of each evaluation and verification invocation.
- The findings that deduplication or verification discards.

Verbose output MUST NOT change the report, the conclusion, or the exit
status. It MUST go to standard error. With `--format json`, standard output
remains exactly one JSON document.

On an interactive terminal, each verbose line MAY carry color and a leading
pointer glyph, with the same color vocabulary as the terminal report. Without
an interactive terminal, each verbose line MUST stay plain text.

## `test`

`standards test` runs rule tests, as specified in
[Standards rule tests](./testing.md). As a checking command, it MUST use the
three exit statuses: `0` when every selected test passes, `1` when at least
one test fails, and `2` when the tests could not run or complete.

## `cache`

`standards cache` manages the persistent source cache defined in
[Standards source cache](./cache.md). It requires a subcommand. Running
`standards cache` without a subcommand MUST print a diagnostic and the help text
to standard error and exit with status `1`. Running `standards cache --help` or
`standards cache -h` MUST print the help text, which lists the `clean` and
`prune` subcommands, to standard output and exit with status `0`.

`standards cache clean` MUST remove all buckets under the resolved cache
directory. It MUST report the removed location and exit with status `0`. If the
cache directory does not exist, it MUST report that state and exit with status
`0`.

`standards cache prune` MUST load `.standards.yml` from the current working
directory, compute the commit object IDs that the resolved knowledge sources
reference, and remove every source cache entry whose commit is not in that
set. It MUST report the number of removed entries and exit with status `0`.

A `cache` subcommand MUST NOT modify the configuration or any other
repository file.

If cache resolution, traversal, or removal fails, the command MUST print the
problem and a relevant next action to standard error. It MUST exit with status
`1`.

## `auth`

`standards auth` groups the credential subcommands, as `cache` groups its own.
Running `standards auth` without a subcommand, or with `--help` or `-h`, MUST
print the `auth` help text, which lists the `login`, `logout`, and `status`
subcommands, to standard output and exit with status `0`.

An `auth` subcommand MUST NOT modify the configuration or any other
repository file.

### `auth login`

`standards auth login <provider>` stores a credential for one model provider,
as specified in [Standards provider credentials](./credentials.md). For a
provider with subscription support, it runs the provider's OAuth flow. For
other providers, it runs the interactive authentication method that the
provider SDK defines. This method can request an API key or provider values
such as a project, location, or profile. A secret prompt does not echo its
value.

On success, the command MUST report the provider and the credential kind and
exit with status `0`. It MUST NOT print the stored secret.

Running `standards auth login` without a provider, or with an unknown
provider, MUST print a diagnostic that lists the known providers to standard
error and exit with status `1`. On an interactive terminal,
`standards auth login` without a provider MAY instead prompt the user to
choose from the known providers and continue with that choice.

### `auth logout`

`standards auth logout <provider>` MUST remove the stored credential for that
provider and report the removal. When no credential is stored for that
provider, it MUST report that state. Both cases exit with status `0`.

### `auth status`

`standards auth status` reports the credential state of each model provider.
The command is read only: it MUST NOT modify the configuration or any
credential.

For each provider with a usable credential, the command MUST print one line
with the provider id, the credential state, and its source:

- `stored`, with the credential kind, for a credential that
  `standards auth login` saved in `auth.json`.
- `environment`, with the source that the provider SDK names, for an ambient
  credential.

The state comes from the credential store metadata and the SDK `checkAuth`
operation, as defined in
[Standards provider credentials](./credentials.md). Providers without a usable
credential MUST NOT be listed. A footer MUST state the count of providers with
a usable credential and the count of known providers. When no provider has a
usable credential, the command MUST print a message that names
`standards auth login <provider>` as the next action.

The credential check is best effort per provider: a provider whose check fails
MUST NOT stop the command, and the command MUST report that its state is
unknown rather than report it as having no credential. The line for that
provider MUST name the problem that the check reported.

As a checking command, `auth status` MUST use three exit statuses: `0` when at
least one provider has a usable credential, `1` when the command ran
completely and no provider has one, and `2` when the command could not run or
complete.

## `models`

`standards models [provider]` lists model references, grouped by provider, so
that a user can see which models the configured credentials make usable. Every
model line MUST be a complete `<provider>/<model>` reference that the user can
pass to `--model` without edits. The command is read only.

By default the command MUST list only the providers with a usable credential,
with the models that the SDK reports as available for each. Each provider
heading MUST show the credential state in the `auth status` format. The
provider's default model, defined in [Standards review](./review.md), MUST be
marked `(default)`.

The default view SHOULD hide a model whose id is another listed model's id plus
a release date suffix, for example `claude-haiku-4-5-20251001` when
`claude-haiku-4-5` is listed. The moving alias is the reference a user should
pass. `--all` MUST show every id without this filter.

A footer MUST state the count of providers with a usable credential and the
count of known providers, and MUST name `standards models --all` and
`standards auth login <provider>` as next actions.

The `[provider]` argument scopes the output to one provider. A provider without
a usable credential MUST show its complete catalog and a
`standards auth login <provider>` hint. An unknown provider MUST print the
diagnostic that lists the known providers and exit with status `1`.

`--all` MUST list every known provider with its credential state and its
complete catalog, credentialed or not.

An auth check or catalog failure for one provider MUST print a note under that
provider, and the command MUST continue with the other providers. When no
provider has a usable credential, the default view MUST print the next-action
guidance and exit with status `0`; `auth status` is the command that signals
this state through its exit status.

`models` is not a checking command: it exits with status `0` on success and
status `1` on any failure.

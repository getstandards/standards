# Standards CLI

Defines the command-line interface for Standards.

## Purpose

The Standards CLI lets users create a Standards configuration, validate and
resolve its rules, update its lock file, and review changes from a terminal or
automation environment.

The CLI implementation MUST be defined in `src/cli`.

## Commands

The executable name is `standards`. It provides these commands:

| Command | Purpose | Current behavior |
| --- | --- | --- |
| `standards init` | Create an initial Standards configuration. | No operation. |
| `standards validate` | Validate the configuration and resolve its complete rule set. | Implemented. |
| `standards lock` | Resolve mutable Git sources and update the lock file. | Implemented. |
| `standards review` | Review changes against the resolved rule set. | No operation. |

## General behavior

Running `standards` without a command or with `--help` or `-h` MUST print help
to standard output and exit with status `0`.

An unknown command MUST print a diagnostic and the help text to standard error.
It MUST exit with status `1`.

Commands do not accept arguments or options in this version. Supplying an
argument or option to a command MUST print a diagnostic to standard error and
exit with status `1`.

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

## Reserved commands

`init` and `review` reserve their command names for future behavior. They MUST
exit with status `0` without output or other effects.
